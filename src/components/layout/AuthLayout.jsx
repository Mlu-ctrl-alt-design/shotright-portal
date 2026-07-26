import Logo from './Logo'

/**
 * Chrome for the guest screens (login, register).
 *
 * The designs put a centred card on a full-bleed, heavily blurred warm-orange
 * photograph, with the logo, product name and tagline stacked above the card.
 *
 * PLACEHOLDER BACKGROUND — that photograph is not in this repo. The layered
 * radial gradients below reproduce its palette and soft shape so the screen is
 * not obviously unfinished. Drop the real image in and swap `backgroundImage`
 * for a url(); the rest of the layout already matches.
 */
export default function AuthLayout({ children, wide = false }) {
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
      <div className="flex min-h-dvh items-center justify-center px-6 py-14">
        <div className={wide ? 'w-full max-w-xl' : 'w-full max-w-md'}>
          <header className="text-center">
            <Logo size="lg" />
            <h1 className="mt-5 text-3xl font-bold text-ink-700">Sho&rsquo;t Right Partner Portal</h1>
            <p className="mx-auto mt-3 max-w-xs text-sm leading-relaxed text-ink-700">
              {/* Design reads "dinning"; corrected to "dining" — see the note in
                  the PRD appendix. "Yonkinto" is deliberate slang, left as-is. */}
              Unlocking hidden dining gems Mzansi has to offer! Vibes, mood &amp; Yonkinto all in one
              place!
            </p>
          </header>

          <div className="mt-10 rounded-3xl bg-canvas p-8 shadow-sm sm:p-10">{children}</div>
        </div>
      </div>
    </div>
  )
}
