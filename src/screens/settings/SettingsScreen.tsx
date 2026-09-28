import type { AppData } from '../../data/mirror.ts'
import { sortRules } from '../../domain/status.ts'
import type { CalcContext } from '../../domain/types.ts'
import { env } from '../../env.ts'
import { AppShell } from '../../layout/AppShell.tsx'
import { SectionTitle } from '../../ui/controls.tsx'
import { AccountsSection } from './AccountsSection.tsx'
import { AppSection } from './AppSection.tsx'
import { HolidaysEditor } from './HolidaysEditor.tsx'
import { SettingsForm } from './SettingsForm.tsx'
import { StatusRulesEditor } from './StatusRulesEditor.tsx'

export function SettingsScreen({ data, calc }: { data: AppData; calc: CalcContext }) {
  const rules = sortRules(calc.rules.values())
  const pending = data.outbox.length
  return (
    <AppShell
      title="Réglages"
      hero={
        <p className="max-w-sm text-[0.9375rem] text-header-ink-2">
          Tarifs, statuts et jours fériés sont partagés entre les deux téléphones.
        </p>
      }
    >
      <SectionTitle>Employée et tarifs</SectionTitle>
      <SettingsForm settings={calc.settings} rules={rules} />

      <SectionTitle>Statuts</SectionTitle>
      <p className="-mt-1 mb-3 text-[0.9375rem] text-ink-2">Heures payées et transport de chaque statut ; le montant par jour se met à jour.</p>
      <StatusRulesEditor rules={rules} settings={calc.settings} />

      <SectionTitle>Jours fériés</SectionTitle>
      <HolidaysEditor holidays={calc.holidays} settings={calc.settings} />

      {env.isRemote ? (
        <>
          <SectionTitle>Comptes</SectionTitle>
          <AccountsSection members={data.members} pending={pending} />
        </>
      ) : null}

      <SectionTitle>Application</SectionTitle>
      <AppSection pending={pending} />
    </AppShell>
  )
}
