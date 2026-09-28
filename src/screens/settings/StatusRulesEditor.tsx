import { nowIso } from '../../data/commands.ts'
import { useEngine } from '../../data/DataProvider.tsx'
import { formatRs } from '../../domain/format.ts'
import { dayAmountCents } from '../../domain/pay.ts'
import type { Settings, StatusRule } from '../../domain/types.ts'
import { StatusGlyph } from '../../ui/StatusGlyph.tsx'
import { Card, Stepper, Switch } from '../../ui/controls.tsx'

/** Effet de chaque statut : heures payées et transport, modifiables. */
export function StatusRulesEditor({ rules, settings }: { rules: StatusRule[]; settings: Settings }) {
  const engine = useEngine()
  const patch = (code: string, change: { paidHours?: number; transportPaid?: boolean }) =>
    void engine.commit({ kind: 'statusRule.patch', code, patch: change, at: nowIso() })

  return (
    <Card padded={false}>
      <ul className="divide-y divide-line">
        {rules.map((rule) => {
          const amount = dayAmountCents(rule.paidHours, settings.hourlyRate, rule.transportPaid, settings.transportPerDay)
          return (
            <li key={rule.code} className="px-4 py-3">
              <div className="flex items-center gap-2.5">
                <StatusGlyph rule={rule} size={18} />
                <p className="min-w-0 flex-1 font-bold leading-tight text-ink">{rule.label}</p>
                <p className="num shrink-0 text-[0.9375rem] font-bold text-ink-2">{formatRs(amount.totalCents)}</p>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <Stepper
                  label={`Heures payées, ${rule.label}`}
                  value={rule.paidHours}
                  onChange={(paidHours) => patch(rule.code, { paidHours })}
                />
                <label className="flex shrink-0 items-center text-[0.9375rem] text-ink-2">
                  Transport
                  <Switch
                    label={`Transport payé, ${rule.label}`}
                    checked={rule.transportPaid}
                    onChange={(transportPaid) => patch(rule.code, { transportPaid })}
                  />
                </label>
              </div>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
