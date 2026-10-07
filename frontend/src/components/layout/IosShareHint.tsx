import { Download } from 'lucide-react';

/**
 * iOS Safari hint block for the hamburger menu.
 *
 * iOS Safari does not implement `beforeinstallprompt`, so there is no
 * clickable install action we can offer on iPhone or iPad. Instead we
 * show a short instruction plus a small illustration that points at
 * the Safari Share button (the square with an arrow pointing up in the
 * bottom toolbar). The user taps that, then "Sur l'écran d'accueil".
 *
 * The illustration is a self-contained inline SVG: no external image
 * to host, no CDN dependency, and it scales cleanly.
 *
 * The container uses the same contained-filament "tube" style as the
 * Chromium install button (thick cyan border + thin near-white inset
 * ring + inward bloom). Nothing extends outside the box.
 *
 * Layout note: the title's icon is shrink-0 and the text is allowed to
 * wrap. On the ~176px of horizontal room the sheet gives us, keeping
 * "INSTALLER L'APPLICATION" on one line would overflow.
 */
export function IosShareHint() {
    return (
        <div
            className='rounded-lg px-3 py-3 text-xs'
            style={{
                backgroundColor: '#080D1A',
                border: '2px solid #00C8FF',
                boxShadow: [
                    'inset 0 0 0 1px #FFFDF0',
                    'inset 0 0 12px rgba(0, 200, 255, 0.55)',
                    'inset 0 0 28px rgba(0, 200, 255, 0.15)',
                ].join(', '),
            }}
        >
            <div className='flex items-center justify-center gap-2 text-sm font-bold uppercase tracking-wider text-[#F2F5FA]'>
                <Download
                    className='h-4 w-4 shrink-0'
                    aria-hidden='true'
                />
                <span className='leading-tight'>
                    Installer l'application
                </span>
            </div>

            <IosShareIllustration />

            <p className='mt-2 leading-relaxed text-muted-foreground'>
                Appuyez sur l'icône{' '}
                <span className='font-semibold text-foreground'>
                    Partager
                </span>{' '}
                en bas de l'écran (celle encerclée en cyan), puis sur{' '}
                <span className='font-semibold text-foreground'>
                    « Sur l'écran d'accueil »
                </span>
                .
            </p>
        </div>
    );
}

/**
 * Simplified iPhone outline with the Safari bottom toolbar. The Share
 * icon is drawn larger and encircled in the app's cyan accent so the
 * user can immediately spot where to tap. Adjacent toolbar icons are
 * rendered as small faded dots.
 */
function IosShareIllustration() {
    return (
        <svg
            viewBox='0 0 220 150'
            className='mx-auto mt-2 block h-auto w-full max-w-[170px]'
            role='img'
            aria-label='Emplacement du bouton Partager dans Safari'
        >
            {/* Phone outline */}
            <rect
                x='50'
                y='4'
                width='120'
                height='142'
                rx='16'
                fill='none'
                stroke='rgba(242, 245, 250, 0.35)'
                strokeWidth='2'
            />

            {/* Address bar hint */}
            <rect
                x='60'
                y='16'
                width='100'
                height='10'
                rx='3'
                fill='rgba(242, 245, 250, 0.12)'
            />

            {/* Bottom toolbar background */}
            <rect
                x='60'
                y='120'
                width='100'
                height='16'
                rx='4'
                fill='rgba(242, 245, 250, 0.12)'
            />

            {/* Adjacent toolbar icons, faded (back, forward, bookmarks, tabs) */}
            <circle
                cx='73'
                cy='128'
                r='2.2'
                fill='rgba(242, 245, 250, 0.4)'
            />
            <circle
                cx='91'
                cy='128'
                r='2.2'
                fill='rgba(242, 245, 250, 0.4)'
            />
            <circle
                cx='129'
                cy='128'
                r='2.2'
                fill='rgba(242, 245, 250, 0.4)'
            />
            <circle
                cx='147'
                cy='128'
                r='2.2'
                fill='rgba(242, 245, 250, 0.4)'
            />

            {/* Highlight ring around the Share icon */}
            <circle
                cx='110'
                cy='128'
                r='11'
                fill='none'
                stroke='#00E5FF'
                strokeWidth='1.5'
                opacity='0.75'
            />

            {/* Apple-style Share glyph: a box with an upward arrow.
                Drawn in a 24x24 space, then scaled and centered on the
                ring's position (110, 128). */}
            <g transform='translate(103.5, 120) scale(0.55)'>
                <path
                    d='M6 10h12v11H6z'
                    fill='none'
                    stroke='#00E5FF'
                    strokeWidth='2.4'
                    strokeLinejoin='round'
                />
                <path
                    d='M12 3v11'
                    stroke='#00E5FF'
                    strokeWidth='2.4'
                    strokeLinecap='round'
                />
                <path
                    d='M8 6l4-3 4 3'
                    fill='none'
                    stroke='#00E5FF'
                    strokeWidth='2.4'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                />
            </g>
        </svg>
    );
}