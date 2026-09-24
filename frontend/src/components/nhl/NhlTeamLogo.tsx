import { nhlLogoMap } from '@/lib/NhlLogos';

interface NhlTeamLogoProps {
    abbreviation: string;
    size?: number;
}

export function NhlTeamLogo({
    abbreviation,
    size = 32,
}: NhlTeamLogoProps) {
    const Logo = nhlLogoMap[abbreviation.toUpperCase()];

    // If the abbreviation doesn't exist, don't render anything.
    if (!Logo) {
        return null;
    }

    return <Logo size={size} />;
}