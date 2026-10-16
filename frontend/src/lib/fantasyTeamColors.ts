/**
 * Couleurs des équipes fantasy de la ligue.
 *
 * Chaque équipe fantasy a une couleur qui lui est propre, utilisée
 * partout où on affiche son nom : tableau "Meilleurs pointeurs" de
 * la page Statistiques, plus tard Classement, Marketplace, page
 * Joueur, etc.
 *
 * Le mapping est indexé par FantasyTeamId, PAS par nom. Cela veut
 * dire qu'une couleur survit au renommage d'une équipe : si
 * "Mathieu" change de nom pour "Mat", il garde sa couleur tant que
 * son FantasyTeamId n'a pas changé.
 *
 * Toutes les couleurs ont été choisies pour :
 *   - avoir un bon contraste sur les fonds sombres de l'app
 *     (#050A16 / #080D1A),
 *   - rester visuellement distinctes les unes des autres MÊME à
 *     petite taille de police.
 *
 * COMMENT LA PALETTE A ÉTÉ CONSTRUITE
 *
 * Deux axes sont utilisés pour maximiser la distinction :
 *
 *   1. La teinte (hue). Les 12 couleurs couvrent le cercle
 *      chromatique à intervalles réguliers (rouge, orange, or,
 *      lime, vert, sarcelle, cyan, bleu, indigo, violet, magenta,
 *      rose), donc deux couleurs adjacentes sur le cercle sont
 *      toujours séparées d'au moins ~20° de teinte.
 *
 *   2. La luminosité. Certaines couleurs sont "claires" (or,
 *      cyan, vert, rose, lime) et d'autres "foncées" (sarcelle,
 *      indigo, magenta), donc même une paire proche en teinte
 *      (par exemple sarcelle et cyan) reste lisible comme deux
 *      couleurs distinctes.
 *
 * ÉVITER À L'AVENIR
 *
 * Ne pas ajouter une 13e couleur proche en teinte d'une des 12
 * existantes (par exemple un "jaune pâle" à côté de l'or, ou un
 * "bleu ciel" à côté du bleu). Ça revient au problème qu'on vient
 * de corriger. Si une nouvelle équipe arrive, choisir une teinte
 * dans un des "trous" de la roue (vert-jaune à 100°, ou bleu-vert
 * à 200° par exemple) plutôt qu'un voisin d'une couleur existante.
 *
 * Ids attendus (ordre de création dans LeagueSetupService) :
 *   1  Mathieu
 *   2  Antho
 *   3  Mig
 *   4  Olivier
 *   5  Farn
 *   6  Melis
 *   7  Gui
 *   8  Jp
 *   9  Kev
 *   10 Frank
 *   11 Max
 *   12 Albo
 */

export const FANTASY_TEAM_COLORS: Record<number, string> = {
    // 1  Mathieu — or vif. Teinte 48°, luminosité haute.
    1: '#FFD93D',

    // 2  Antho — cyan électrique. Teinte 187°, très clair.
    2: '#00E5FF',

    // 3  Mig — violet vif. Teinte 262°.
    3: '#A855F7',

    // 4  Olivier — vert clair. Teinte 142°.
    4: '#4ADE80',

    // 5  Farn — orange vif. Teinte 15°, chaud, saturé.
    5: '#FF6B35',

    // 6  Melis — rose clair. Teinte 330°.
    6: '#F472B6',

    // 7  Gui — lime pastel. Teinte 75°, clair.
    7: '#BEF264',

    // 8  Jp — bleu royal. Teinte 217°.
    8: '#3B82F6',

    // 9  Kev — rouge vif. Teinte 0°.
    9: '#EF4444',

    // 10 Frank — magenta profond. Teinte 292°, plus sombre
    //            que le violet, ce qui le différencie nettement.
    10: '#D946EF',

    // 11 Max — sarcelle. Teinte 173°, plus sombre que le cyan
    //          de Antho (teinte 187°), donc même si les deux sont
    //          proches en teinte, la luminosité les sépare.
    11: '#14B8A6',

    // 12 Albo — indigo. Teinte 239°, entre le bleu (217°) et le
    //           violet (262°), teinte qui était vide dans la
    //           première version.
    12: '#6366F1',
};

/**
 * Couleur utilisée quand un FantasyTeamId n'est pas dans le mapping.
 * Alignée sur l'accent cyan de la ligue pour que la ligne reste
 * lisible même si une nouvelle équipe est créée avant qu'on ait
 * pensé à lui donner une couleur.
 */
export const DEFAULT_FANTASY_TEAM_COLOR = '#00E5FF';

/**
 * Retourne la couleur associée à une équipe fantasy, ou la couleur
 * par défaut si l'id n'est pas connu.
 */
export function getFantasyTeamColor(fantasyTeamId: number): string {
    return (
        FANTASY_TEAM_COLORS[fantasyTeamId] ??
        DEFAULT_FANTASY_TEAM_COLOR
    );
}