import { clsx } from '../../utils/clsx'
import logoUrl from '../../assets/logo.png'

/**
 * Sho't Right brand mark — the illustrated badge (suitcase, beach umbrella,
 * drink) that appears in every design frame.
 *
 * PROVENANCE: extracted at native resolution from the approved design frame
 * `setup mood.png`, where the badge sits on the flat #FEC32D sidebar. The
 * background was removed by flooding inward from the edges rather than by
 * colour-keying, so the yellow *inside* the badge (the suitcase body, the
 * lettering) is preserved. Checked against the yellow sidebar, the warm auth
 * wash and the light card — no edge fringing on any of them.
 *
 * This is a faithful derivative, not the designer's original export. The
 * original lives in Drive as `Logo_ShotRight_Smaller.png` (129x110), with
 * `Logo_ShotRight.png` and `_Bigger.png` alongside it. Committing the original
 * over this file is a drop-in replacement — nothing here needs to change. At
 * 180x154 this asset is larger than the Drive export and stays crisp at every
 * size used below.
 */
export default function Logo({ size = 'md', className }) {
  const sizes = {
    sm: 'h-10',
    md: 'h-16',
    lg: 'h-24',
  }

  return (
    <div className={clsx('flex justify-center select-none', className)}>
      <img src={logoUrl} alt="Sho't Right" className={clsx('w-auto', sizes[size])} />
    </div>
  )
}
