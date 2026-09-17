import { Link } from 'react-router-dom'
import Logo from './Logo'

/**
 * Chrome for the guest screens (login, register, forgot password, verify).
 *
 * The designs put a centred card on a full-bleed, heavily blurred warm-orange
 * photograph.
 *
 * PLACEHOLDER BACKGROUND — that photograph is not in this repo. The layered
 * radial gradients below reproduce its palette and soft shape so the screen is
 * not obviously unfinished. Drop the real image in and swap `backgroundImage`
 * for a url(); the rest of the layout already matches. (The 17 Sep Login
 * design ships these same four gradients verbatim, so they are now the
 * intended background rather than a stand-in for one.)
 *
 * `minimal` is the 17 Sep Login chrome: the logo alone over the card, a single
 * link in the top-right, and the legal links in a footer. The default keeps the
 * older stacked header — product name and tagline above the card — because the
 * other guest screens were drawn with it and have not been redrawn. Two shapes
 * on purpose; one of them is not quietly imposed on screens nobody redesigned.
 */
export default function AuthLayout({
  children,
  wide = false,
  minimal = false,
  topRight = null,
  footer = false,
}) {
  return (
    <div
      className="relative min-h-dvh overflow-hidden bg-deep-500"
      style={{
        backgroundImage: [
          'radial-gradient(1200px 800px at 12% 4%, rgba(255,255,255,0.92), transparent 55%)',
          'radial-gradient(900px 700px at 88% 22%, rgba(254,195,45,0.95), transparent 60%)',
          'radial-gradient(1000px 900px at 30% 92%, rgba(251,171,41,0.95), transparent 62%)',
          'radial-gradient(700px 600px at 70% 78%, rgba(255,255,255,0.28), transparent 60%)',
        ].join(','),
      }}
    >
      <div className="flex min-h-dvh flex-col">
        {topRight && (
          <header className="flex items-center justify-end gap-4 px-6 py-5">{topRight}</header>
        )}

        <main
          className={
            minimal
              ? 'flex flex-1 items-center justify-center px-6 pt-2 pb-16'
              : 'flex flex-1 items-center justify-center px-6 py-14'
          }
        >
          <div className={wide ? 'w-full max-w-xl' : minimal ? 'w-full max-w-[392px]' : 'w-full max-w-md'}>
            {minimal ? (
              <Logo size="lg" className="mb-5" />
            ) : (
              <header className="text-center">
                <Logo size="lg" />
                <h1 className="mt-5 text-3xl font-bold text-ink-700">
                  Sho&rsquo;t Right Partner Portal
                </h1>
                <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-ink-700">
                  {/* Design reads "dinning"; corrected to "dining" — see the note in
                      the PRD appendix. "Yonkinto" is deliberate slang, left as-is. */}
                  Unlocking hidden dining gems Mzansi has to offer! Vibes, mood &amp; Yonkinto all
                  in one place!
                </p>
              </header>
            )}

            <div
              className={
                minimal
                  ? 'rounded-3xl bg-canvas px-7 pt-8 pb-7 shadow-md'
                  : 'mt-10 rounded-3xl bg-canvas p-8 shadow-sm sm:p-10'
              }
            >
              {children}
            </div>
          </div>
        </main>

        {footer && (
          <footer className="flex justify-center gap-4 px-6 pb-7">
            {/* One page, two anchors. `/legal` is the only legal route there
                is — pointing "Terms" and "Privacy" at invented paths would be
                two 404s on the screen a partner trusts least. */}
            <Link to="/legal#terms" className="text-xs text-ink-900 hover:underline">
              Terms
            </Link>
            <Link to="/legal#privacy" className="text-xs text-ink-900 hover:underline">
              Privacy
            </Link>
          </footer>
        )}
      </div>
    </div>
  )
}
