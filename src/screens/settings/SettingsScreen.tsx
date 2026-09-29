import type { AppData } from '../../data/mirror.ts'
import { sortRules } from '../../domain/status.ts'
import type { CalcContext } from '../../domain/types.ts'
import { env } from '../../env.ts'
import { AppShell } from '../../layout/AppShell.tsx'
import { SectionTitle } from '../../ui/controls.tsx'
import { AccountsSection } from './AccountsSection.tsx'
import { AppSection } from './AppSection.tsx'
import { ContributionsEditor } from './ContributionsEditor.tsx'
import { HolidaysEditor } from './HolidaysEditor.tsx'
import { IdentityForm } from './IdentityForm.tsx'
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

      <SectionTitle>Fiche de paie</SectionTitle>
      <p className="-mt-1 mb-3 text-[0.9375rem] text-ink-2">Imprimé sur chaque fiche de paie (Budget → Fiche de paie).</p>
      <div className="flex flex-col gap-3">
        <IdentityForm kind="employee" settings={calc.settings} />
        <IdentityForm kind="employer" settings={calc.settings} />
      </div>

      <SectionTitle>Cotisations</SectionTitle>
      <p className="-mt-1 mb-3 text-[0.9375rem] text-ink-2">
        Retenues sur le salaire et cotisations patronales. Taux révisés chaque année : vérifiez-les auprès de la MRA.
      </p>
      <ContributionsEditor calc={calc} />

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
