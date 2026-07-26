import { Alert } from '../../../../components/ui'

/**
 * Placeholder body for the wizard steps whose content is still blocked on a
 * product decision (see docs/PRD-shot-right-partner-portal.md §7.5).
 *
 * The wizard chrome — rail, navigation, validation wiring — is finished, so
 * each of these becomes a drop-in replacement once its conflict is resolved.
 */
export default function PendingStep({ blockedBy, summary, screens }) {
  return (
    <div className="space-y-5">
      <Alert variant="warning">
        <p className="font-bold">Blocked on {blockedBy}</p>
        <p className="mt-1">{summary}</p>
      </Alert>

      {screens?.length > 0 && (
        <div className="rounded-2xl bg-canvas p-5">
          <p className="text-xs font-bold tracking-wide uppercase text-ink-500">
            Designs for this step
          </p>
          <ul className="mt-2 space-y-1 text-sm text-ink-700">
            {screens.map((screen) => (
              <li key={screen} className="font-mono text-xs">
                {screen}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
