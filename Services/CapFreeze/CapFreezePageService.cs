using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.NHL;
using System.Net.Http;

namespace NhlFantasyLeague.api.Services.CapFreeze
{
    public class CapFreezePageService
    {
        private readonly HttpClient _httpClient;
        private readonly AppDbContext _dbContext;

        public CapFreezePageService(
    HttpClient httpClient,
    AppDbContext dbContext)
        {
            _httpClient = httpClient;
            _dbContext = dbContext;
        }

        public async Task<string> GetCapFreezeTeamPageAsync(string teamSlug)
        {
            var url = $"https://capfreeze.com/teams/{teamSlug}.html";

            return await _httpClient.GetStringAsync(url);
        }

        public async Task<string> GetCapFreezePlayerPageAsync(
string playerSlug)
        {
            var url =
                $"https://capfreeze.com/players/{playerSlug}.html";

            return await _httpClient.GetStringAsync(url);
        }

        public List<string> ExtractCapFreezeSectionPlayers(
string html,
string sectionName)
        {
            var document = new HtmlAgilityPack.HtmlDocument();

            document.LoadHtml(html);

            var sectionHeader = document.DocumentNode
                .SelectSingleNode(
                    $"//h2[contains(normalize-space(), '{sectionName}')]");

            if (sectionHeader == null)
                return new List<string>();

            var players = new List<string>();

            var table = sectionHeader
                .SelectSingleNode("following-sibling::table[1]");

            if (table == null)
                return players;

            var rows = table.SelectNodes(".//tr");

            if (rows == null)
                return players;

            foreach (var row in rows)
            {
                var playerLink = row.SelectSingleNode(".//a");

                if (playerLink == null)
                    continue;

                var playerName = System.Net.WebUtility.HtmlDecode(
                    playerLink.InnerText.Trim());

                if (!string.IsNullOrWhiteSpace(playerName))
                    players.Add(playerName);
            }

            return players;
        }

        public List<CapFreezePlayerLink> ExtractCapFreezePlayerLinks(
string html,
string sectionName)
        {
            var document =
                new HtmlAgilityPack.HtmlDocument();

            document.LoadHtml(html);

            var sectionHeader =
                document.DocumentNode.SelectSingleNode(
                    $"//h2[contains(normalize-space(), '{sectionName}')]");

            if (sectionHeader == null)
                return new List<CapFreezePlayerLink>();

            var players =
                new List<CapFreezePlayerLink>();

            var table =
                sectionHeader.SelectSingleNode(
                    "following-sibling::table[1]");

            if (table == null)
                return players;

            var rows =
                table.SelectNodes(".//tr");

            if (rows == null)
                return players;

            foreach (var row in rows)
            {
                var playerLink =
                    row.SelectSingleNode(".//a");

                if (playerLink == null)
                    continue;

                var name =
                    System.Net.WebUtility.HtmlDecode(
                        playerLink.InnerText.Trim());

                var href =
                    playerLink.GetAttributeValue(
                        "href",
                        string.Empty);

                if (string.IsNullOrWhiteSpace(name) ||
                    string.IsNullOrWhiteSpace(href))
                {
                    continue;
                }

                var uri =
                    new Uri(
                        new Uri("https://capfreeze.com/"),
                        href);

                var slug =
                    System.IO.Path.GetFileNameWithoutExtension(
                        uri.AbsolutePath);

                // Position column is usually the second td
                var positionCell =
                    row.SelectSingleNode("./td[2]");

                var position =
                    positionCell == null
                        ? string.Empty
                        : positionCell.InnerText.Trim();

                players.Add(
                    new CapFreezePlayerLink
                    {
                        Name = name,
                        Slug = slug,
                        Position = position
                    });
            }

            return players;
        }

        public async Task<decimal?> TestExtractCapHitAsync(
string teamSlug,
string playerSlug,
int season)
        {
            var teamUrl =
                $"https://capfreeze.com/teams/{teamSlug}.html";

            var html = await _httpClient.GetStringAsync(teamUrl);

            var playerMarker =
                $"../players/{playerSlug}.html";

            var playerIndex = html.IndexOf(
                playerMarker,
                StringComparison.OrdinalIgnoreCase);

            if (playerIndex == -1)
                return null;

            var nextTableEnd = html.IndexOf(
                "</tr>",
                playerIndex,
                StringComparison.OrdinalIgnoreCase);

            if (nextTableEnd == -1)
                return null;

            var row = html[playerIndex..nextTableEnd];

            var pattern =
                $@"data-season=""{season}""[^>]*data-cap=""(\d+(?:\.\d+)?)""";

            var match = System.Text.RegularExpressions.Regex.Match(
                row,
                pattern,
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);

            if (!match.Success)
                return null;

            if (!decimal.TryParse(
                    match.Groups[1].Value,
                    out var capHit))
            {
                return null;
            }

            return capHit;
        }

        public List<decimal> TestExtractCapHitsFromRow()
        {
            var row = """
        <tr><td><a href="../players/ivan-demidov.html">Ivan Demidov</a></td><td>RW</td>
        <td class="num" data-v="20">20</td>
        <td class="num moneycell" data-cap="940833" data-cash="975000" data-v="940833">$940,833</td><td class="num moneycell" data-cap="9150000" data-cash="12500000" data-v="9150000">$9,150,000</td><td class="num moneycell" data-cap="9150000" data-cash="12500000" data-v="9150000">$9,150,000</td><td class="num moneycell" data-cap="9150000" data-cash="10500000" data-v="9150000">$9,150,000</td><td class="num moneycell" data-cap="9150000" data-cash="7700000" data-v="9150000">$9,150,000</td>
        <td class="num" data-v="0.00905">0.9%</td></tr>
        """;

            var matches = System.Text.RegularExpressions.Regex.Matches(
                row,
                @"<td[^>]*class=""[^""]*moneycell[^""]*""[^>]*data-cap=""(\d+(?:\.\d+)?)""",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);

            var capHits = new List<decimal>();

            foreach (System.Text.RegularExpressions.Match match in matches)
            {
                if (decimal.TryParse(
                        match.Groups[1].Value,
                        out var capHit))
                {
                    capHits.Add(capHit);
                }
            }

            return capHits;
        }
    }
}
