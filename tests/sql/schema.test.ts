// Exécute les vraies migrations Supabase dans PGlite (Postgres compilé en
// WebAssembly) avec un bouchon de l'environnement Supabase, puis vérifie la
// RLS, la garde d'inscription et la résolution des conflits.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..', '..')
const read = (path: string) => readFileSync(join(root, path), 'utf8')
const migrations = readdirSync(join(root, 'supabase/migrations'))
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => read(join('supabase/migrations', file)))

interface User {
  id: string
  email: string
}

const ALICE: User = { id: '00000000-0000-4000-8000-00000000000a', email: 'alice@example.com' }
const BOB: User = { id: '00000000-0000-4000-8000-00000000000b', email: 'bob@example.com' }
const MALLORY: User = { id: '00000000-0000-4000-8000-0000000000ff', email: 'mallory@example.com' }

type Row = Record<string, unknown>

/** Horodatage ISO `minutes` minutes dans le passé (le serveur plafonne le futur à now()). */
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

let db: PGlite

/** Exécute `fn` avec le rôle `authenticated` et le JWT de `user`. */
async function as<T>(user: User | 'anon', fn: () => Promise<T>): Promise<T> {
  const role = user === 'anon' ? 'anon' : 'authenticated'
  const claims = user === 'anon' ? { role } : { sub: user.id, email: user.email, role }
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)])
  await db.exec(`set role ${role}`)
  try {
    return await fn()
  } finally {
    await db.exec(`reset role`)
    await db.query(`select set_config('request.jwt.claims', '', false)`)
  }
}

async function rows(sql: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(sql, params)).rows
}

async function setAttendance(date: string, status: string, at: string, hours: number | null = null, comment: string | null = null) {
  const [row] = await rows(`select public.set_attendance($1, $2, $3, $4, $5) as r`, [date, status, hours, comment, at])
  return row?.r as Row | null
}

async function clearAttendance(date: string, at: string) {
  const [row] = await rows(`select public.clear_attendance($1, $2) as r`, [date, at])
  return row?.r as Row | null
}

async function errorCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise
  } catch (error) {
    return (error as { code?: string }).code ?? 'unknown'
  }
  return undefined
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(read('tests/sql/supabase-stub.sql'))
  for (const sql of migrations) await db.exec(sql)
  await db.exec(read('supabase/seed.sql'))
  // Rejouer les données de référence et le seed ne doit rien casser.
  await db.exec(migrations[1]!)
  await db.exec(read('supabase/seed.sql'))

  await db.exec(`
    insert into public.allowed_emails (email, display_name) values
      ('  Alice@Example.com ', 'Alice'), ('bob@example.com', 'Bob');
  `)
  await db.query(`insert into auth.users (id, email) values ($1, $2), ($3, $4)`, [
    ALICE.id, ALICE.email, BOB.id, 'BOB@example.com',
  ])
}, 60_000)

describe('données de référence', () => {
  it('crée une ligne de réglages unique avec les valeurs par défaut', async () => {
    const settings = await rows(`select * from public.settings`)
    expect(settings).toHaveLength(1)
    expect(settings[0]).toMatchObject({
      id: 1,
      hourly_rate: '170.00',
      hours_per_day: '3.00',
      transport_per_day: '48.00',
      work_days: [1, 2, 3, 4, 5],
      employee_name: '',
    })
    expect(await errorCode(db.exec(`insert into public.settings (id) values (2)`))).toBe('23514')
  })

  it('charge 10 statuts et 20 jours fériés', async () => {
    expect(await rows(`select code from public.status_rules`)).toHaveLength(10)
    const holidays = await rows(`select date::text as date from public.holidays order by date`)
    expect(holidays).toHaveLength(20)
    expect(holidays.filter((h) => String(h.date).startsWith('2026'))).toHaveLength(4)
  })

  it('publie les tables utiles dans supabase_realtime', async () => {
    const published = await rows(
      `select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by tablename`,
    )
    expect(published.map((r) => r.tablename)).toEqual([
      'allowed_emails', 'attendance_overrides', 'holidays', 'settings', 'status_rules',
    ])
  })
})

describe('comptes et inscription', () => {
  it('normalise les adresses et relie les comptes existants', async () => {
    const members = await rows(`select email, user_id from public.allowed_emails order by email`)
    expect(members).toEqual([
      { email: 'alice@example.com', user_id: ALICE.id },
      { email: 'bob@example.com', user_id: BOB.id },
    ])
  })

  it('refuse la création d’un compte hors liste', async () => {
    const code = await errorCode(
      db.query(`insert into auth.users (id, email) values ($1, $2)`, [MALLORY.id, MALLORY.email]),
    )
    expect(code).toBe('42501')
  })

  it('un membre ne peut pas retirer sa propre adresse, mais peut retirer l’autre', async () => {
    await as(ALICE, async () => {
      await db.exec(`delete from public.allowed_emails where email = 'alice@example.com'`)
      expect(await rows(`select email from public.allowed_emails`)).toHaveLength(2)
      await db.exec(`insert into public.allowed_emails (email) values ('Charlie@Example.com')`)
      await db.exec(`delete from public.allowed_emails where email = 'charlie@example.com'`)
      expect(await rows(`select email from public.allowed_emails order by email`)).toHaveLength(2)
    })
  })

  it('un membre peut renommer un compte mais pas changer son adresse', async () => {
    await as(ALICE, async () => {
      await db.exec(`update public.allowed_emails set display_name = 'Bobby' where email = 'bob@example.com'`)
      expect(await errorCode(db.exec(`update public.allowed_emails set email = 'x@example.com'`))).toBe('42501')
    })
    expect(await rows(`select display_name from public.allowed_emails where email = 'bob@example.com'`)).toEqual([
      { display_name: 'Bobby' },
    ])
  })
})

describe('RLS', () => {
  it('le rôle anonyme n’a accès à rien', async () => {
    await as('anon', async () => {
      expect(await errorCode(db.query(`select * from public.holidays`))).toBe('42501')
      expect(await errorCode(db.query(`select * from public.attendance_overrides`))).toBe('42501')
      expect(await errorCode(db.query(`select public.set_attendance('2026-10-05', 'travaille')`))).toBe('42501')
    })
  })

  it('un utilisateur authentifié hors liste ne voit ni n’écrit rien', async () => {
    await as(MALLORY, async () => {
      expect(await rows(`select * from public.settings`)).toHaveLength(0)
      expect(await rows(`select * from public.holidays`)).toHaveLength(0)
      expect(await rows(`select * from public.allowed_emails`)).toHaveLength(0)
      expect(await errorCode(setAttendance('2026-10-05', 'conge_non_paye', ago(10)))).toBe('42501')
      expect(await errorCode(db.exec(`insert into public.holidays (date, name) values ('2026-10-01', 'Pirate')`))).toBe('42501')
      await db.exec(`update public.settings set hourly_rate = 1`)
    })
    expect(await rows(`select hourly_rate from public.settings`)).toEqual([{ hourly_rate: '170.00' }])
  })

  it('un membre lit toutes les données', async () => {
    await as(BOB, async () => {
      expect(await rows(`select * from public.settings`)).toHaveLength(1)
      expect(await rows(`select * from public.status_rules`)).toHaveLength(10)
      expect(await rows(`select * from public.holidays`)).toHaveLength(20)
    })
  })

  it('un membre modifie les réglages et les statuts, pas les colonnes protégées', async () => {
    await as(ALICE, async () => {
      await db.exec(`update public.settings set hourly_rate = 175, updated_at = now()`)
      expect(await errorCode(db.exec(`update public.settings set id = 2`))).toBe('42501')
      await db.exec(`update public.status_rules set paid_hours = 2 where code = 'demi_journee'`)
      expect(await errorCode(db.exec(`update public.status_rules set label = 'X'`))).toBe('42501')
      expect(await errorCode(db.exec(`delete from public.status_rules where code = 'week_end'`))).toBe('42501')
    })
    const [settings] = await rows(`select hourly_rate, updated_by from public.settings`)
    expect(settings).toEqual({ hourly_rate: '175.00', updated_by: ALICE.id })
    await db.exec(`update public.settings set hourly_rate = 170; update public.status_rules set paid_hours = 1.5 where code = 'demi_journee'`)
  })

  it('un membre renseigne la fiche de paie et les cotisations, dans les limites prévues', async () => {
    const contributions = [{ id: 'csg', label: 'CSG', brackets: [{ upTo: null, employeeRate: 1.5, employerRate: 3 }] }]
    await as(BOB, async () => {
      await db.query(
        `update public.settings set employee_full_name = $1, employee_hire_date = $2, employer_registration = $3,
                pay_day = 5, round_contributions = false, contributions = $4::jsonb, updated_at = now()`,
        ['Marie-Claire Dupont', '2026-09-01', 'ERN123', JSON.stringify(contributions)],
      )
      expect(await errorCode(db.exec(`update public.settings set contributions = '{}'::jsonb`))).toBe('23514')
      expect(await errorCode(db.exec(`update public.settings set pay_day = 31`))).toBe('23514')
      expect(await errorCode(db.exec(`update public.settings set employee_nic = repeat('A', 21)`))).toBe('23514')
    })
    await as(MALLORY, async () => {
      await db.exec(`update public.settings set employer_name = 'Pirate'`)
    })
    const [settings] = await rows(
      `select employee_full_name, employee_hire_date::text as hire, employer_name, pay_day, round_contributions,
              contributions, updated_by from public.settings`,
    )
    expect(settings).toEqual({
      employee_full_name: 'Marie-Claire Dupont',
      hire: '2026-09-01',
      employer_name: '',
      pay_day: 5,
      round_contributions: false,
      contributions,
      updated_by: BOB.id,
    })
  })
})

describe('saisies : last-write-wins', () => {
  const DAY = '2026-10-05'

  it('une saisie plus récente remplace, une plus ancienne est ignorée', async () => {
    await as(ALICE, async () => {
      const first = await setAttendance(DAY, 'conge_non_paye', ago(300), null, '  rdv médical ')
      expect(first).toMatchObject({ date: DAY, status_code: 'conge_non_paye', comment: 'rdv médical', updated_by: ALICE.id })

      const stale = await setAttendance(DAY, 'absence_non_payee', ago(360))
      expect(stale).toMatchObject({ status_code: 'conge_non_paye' })
    })
    await as(BOB, async () => {
      const newer = await setAttendance(DAY, 'demi_journee', ago(240), 2)
      expect(newer).toMatchObject({ status_code: 'demi_journee', hours_override: 2, comment: null, updated_by: BOB.id })
    })
  })

  it('une remise au défaut plus ancienne ne supprime pas une saisie plus récente', async () => {
    await as(ALICE, async () => {
      expect(await clearAttendance(DAY, ago(270))).toMatchObject({ status_code: 'demi_journee' })
    })
  })

  it('une saisie hors ligne ancienne ne ressuscite pas une journée remise au défaut', async () => {
    await as(ALICE, async () => {
      expect(await clearAttendance(DAY, ago(180))).toBeNull()
      expect(await setAttendance(DAY, 'conge_non_paye', ago(210))).toBeNull()
      expect(await rows(`select * from public.attendance_overrides where date = $1`, [DAY])).toHaveLength(0)

      const later = await setAttendance(DAY, 'conge_non_paye', ago(150))
      expect(later).toMatchObject({ status_code: 'conge_non_paye' })
      expect(await rows(`select * from public.attendance_tombstones where date = $1`, [DAY])).toHaveLength(0)
    })
  })

  it('rejouer deux fois la même opération est sans effet', async () => {
    await as(BOB, async () => {
      const at = ago(120)
      const once = await setAttendance('2026-10-06', 'absence_non_payee', at)
      const twice = await setAttendance('2026-10-06', 'absence_non_payee', at)
      expect(twice).toEqual(once)
    })
  })

  it('un horodatage dans le futur est ramené à l’heure du serveur', async () => {
    await as(ALICE, async () => {
      const row = await setAttendance('2026-10-07', 'travaille', '2099-01-01T00:00:00Z', null, 'horloge en avance')
      const [{ now }] = (await rows(`select now() as now`)) as [{ now: Date }]
      expect(new Date(String(row?.updated_at)).getTime()).toBeLessThanOrEqual(now.getTime())
    })
  })

  it('refuse un statut inconnu ou des heures hors bornes', async () => {
    await as(ALICE, async () => {
      expect(await errorCode(setAttendance('2026-10-08', 'vacances', ago(10)))).toBe('23503')
      expect(await errorCode(setAttendance('2026-10-08', 'travaille', ago(10), 30))).toBe('23514')
    })
  })
})

describe('jours fériés : last-write-wins', () => {
  it('ignore une mise à jour plus ancienne que la ligne en base', async () => {
    await as(ALICE, async () => {
      const upsert = `
        insert into public.holidays (date, name, updated_at) values ('2027-03-10', $1, $2)
        on conflict (date) do update set name = excluded.name, updated_at = excluded.updated_at`
      await db.query(upsert, ['Eid-Ul-Fitr (confirmé)', new Date().toISOString()])
      // Saisie hors ligne de la veille, rejouée après coup : ignorée.
      await db.query(upsert, ['Ancienne version', ago(24 * 60)])
    })
    const [holiday] = await rows(`select name, updated_by from public.holidays where date = '2027-03-10'`)
    expect(holiday).toEqual({ name: 'Eid-Ul-Fitr (confirmé)', updated_by: ALICE.id })
  })
})
