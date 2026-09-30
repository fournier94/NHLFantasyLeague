import { cn } from '@/lib/utils';
import { useAura } from '@/lib/auraContext';
import {
    auraPulseClass,
    auraPulseStyle,
    auraRangeFor,
    isAuraOff,
} from '@/lib/auraConfig';

/**
 * Reusable neon button with a blue pulsing aura.
 *
 * The look: a solid cyan-bordered, dark-background button when active,
 * a muted transparent button when inactive, with an optional blue
 * text-shadow pulse driven by the 'auraButton' aura channel.
 *
 * Props:
 *   - active: whether the button is the currently selected one.
 *   - onClick: standard click handler.
 *   - children: label content.
 *   - className: extra classes merged onto the button.
 *
 * The aura only applies to the ACTIVE button. Inactive buttons never
 * receive the pulse class, the pulse style, or the CSS variables that
 * drive the keyframe — that guarantees no leftover glow on the
 * inactive state.
 */
export function AuraButton({
    active,
    onClick,
    children,
    className,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
    className?: string;
}) {
    const aura = useAura('auraButton');

    const rest = [
        `0 0 ${auraRangeFor(aura, 'auraButton', 0).toFixed(2)}px rgba(0, 168, 255, 0.85)`,
        `0 0 ${auraRangeFor(aura, 'auraButton', 1).toFixed(2)}px rgba(0, 168, 255, 0.55)`,
        `0 0 ${auraRangeFor(aura, 'auraButton', 2).toFixed(2)}px rgba(0, 168, 255, 0.3)`,
    ].join(', ');

    const peak = [
        `0 0 ${auraRangeFor(aura, 'auraButton', 0).toFixed(2)}px rgba(0, 168, 255, 1)`,
        `0 0 ${auraRangeFor(aura, 'auraButton', 1).toFixed(2)}px rgba(0, 168, 255, 0.75)`,
        `0 0 ${auraRangeFor(aura, 'auraButton', 2).toFixed(2)}px rgba(0, 168, 255, 0.45)`,
    ].join(', ');

    const auraOn = active && !isAuraOff(aura);

    return (
        <button
            type='button'
            onClick={onClick}
            className={cn(
                'cursor-pointer rounded-md px-5 py-2 text-base font-semibold transition-colors duration-200 focus:outline-none focus-visible:outline-none focus-visible:ring-0',
                auraOn ? auraPulseClass('text') : '[text-shadow:none]',
                active
                    ? isAuraOff(aura)
                        ? 'border border-[#00A8FF] bg-[#080D1A] text-[#F2F5FA] shadow-none'
                        : 'border border-[#00A8FF] bg-[#080D1A] text-[#F2F5FA] shadow-[0_0_6px_rgba(255,255,255,0.9),0_0_12px_rgba(0,168,255,0.9),0_0_24px_rgba(0,168,255,0.55),0_0_48px_rgba(0,168,255,0.3),inset_0_0_8px_rgba(0,168,255,0.25)]'
                    : 'border border-border bg-transparent text-muted-foreground shadow-none hover:border-[#00A8FF]/60 hover:text-[#F2F5FA]',
                className,
            )}
            style={
                auraOn
                    ? auraPulseStyle(rest, peak)
                    : undefined
            }
        >
            {children}
        </button>
    );
}