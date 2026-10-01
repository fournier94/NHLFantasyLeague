namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// Canonical classification of a player's raw Position string into
    /// one of three roster slot groups: Forward, Defense, Goalie.
    ///
    /// The NHL API, CapFreeze, ESPN and our own scrapers all spell
    /// positions differently ("LW", "Left Wing", "Ailier gauche",
    /// "AG", ...). Every one of them must collapse onto exactly one
    /// group so the 12F / 6D / 1G active-shape check is reliable.
    /// </summary>
    public enum PositionGroup
    {
        Unknown = 0,
        Forward = 1,
        Defense = 2,
        Goalie = 3
    }

    public static class PositionGroupHelper
    {
        /// <summary>
        /// Maps a raw position string to its group. Case-insensitive,
        /// accent-insensitive, ignores punctuation and extra spaces.
        /// Returns <see cref="PositionGroup.Unknown"/> when the value
        /// cannot be classified.
        /// </summary>
        public static PositionGroup Classify(string? rawPosition)
        {
            if (string.IsNullOrWhiteSpace(rawPosition))
            {
                return PositionGroup.Unknown;
            }

            var normalized = Normalize(rawPosition);

            return normalized switch
            {
                // --- Goalies --------------------------------------------
                "G" or "GK" or "GB" or "GOALIE" or "GOALTENDER"
                    or "GARDIEN" or "GARDIEN DE BUT"
                    => PositionGroup.Goalie,

                // --- Defensemen -----------------------------------------
                "D" or "LD" or "RD" or "DEFENSE" or "DEFENCE"
                    or "DEFENSEMAN" or "DEFENCEMAN"
                    or "LEFT DEFENSE" or "RIGHT DEFENSE"
                    or "DEFENSEUR" or "ARRIERE"
                    => PositionGroup.Defense,

                // --- Forwards -------------------------------------------
                "C" or "CENTER" or "CENTRE"
                    or "L" or "LW" or "LEFT WING" or "LEFTWING"
                    or "R" or "RW" or "RIGHT WING" or "RIGHTWING"
                    or "W" or "WINGER" or "WING"
                    or "F" or "FORWARD"
                    or "AG" or "AD" or "A"
                    or "AILIER" or "AILIER GAUCHE" or "AILIER DROIT"
                    or "AVANT" or "ATTAQUANT"
                    => PositionGroup.Forward,

                _ => PositionGroup.Unknown
            };
        }

        /// <summary>
        /// True when both raw positions map to the same non-Unknown
        /// group. Two Unknowns never match.
        /// </summary>
        public static bool SameGroup(string? a, string? b)
        {
            var ga = Classify(a);
            var gb = Classify(b);

            return ga != PositionGroup.Unknown && ga == gb;
        }

        private static string Normalize(string value)
        {
            // Uppercase + strip accents so "Défenseur" -> "DEFENSEUR",
            // "Arrière" -> "ARRIERE", "Ailier gauche" -> "AILIER GAUCHE".
            var upper = value.Trim().ToUpperInvariant();

            var decomposed = upper.Normalize(
                System.Text.NormalizationForm.FormD);

            var builder = new System.Text.StringBuilder(decomposed.Length);

            foreach (var c in decomposed)
            {
                if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c)
                    != System.Globalization.UnicodeCategory.NonSpacingMark)
                {
                    builder.Append(c);
                }
            }

            // Collapse multiple spaces into one, trim again.
            var collapsed = System.Text.RegularExpressions.Regex
                .Replace(builder.ToString(), @"\s+", " ")
                .Trim();

            return collapsed;
        }
    }
}