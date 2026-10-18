namespace NhlFantasyLeague.api.Models.Dtos
{
    /// <summary>
    /// One player in a trade request. Carries the player's id and,
    /// when the admin wants to change his status as part of the
    /// trade, the new status on the destination team. Null means
    /// "keep the current status" (no change).
    ///
    /// The "current" status is the player's live RosterStatus at the
    /// moment of the finalize. The override, when present, becomes
    /// the player's status on his new team and is written into the
    /// trade's history rows.
    /// </summary>
    public class TradePlayerRequest
    {
        public int PlayerId { get; set; }

        /// <summary>
        /// New status ("Active", "Bench", "Prospect"). Null or
        /// whitespace means "no change".
        /// </summary>
        public string? NewStatus { get; set; }
    }

    /// <summary>
    /// One solo status change applied as part of a trade. The player
    /// is staying on the same team (not being traded); only his
    /// RosterStatus changes at the trade's effective date. Used to
    /// rebalance a team's shape when the trade itself would leave it
    /// out of 12/6/1 + 4/2/1 + 3.
    /// </summary>
    public class TradeExtraStatusChangeRequest
    {
        public int PlayerId { get; set; }

        /// <summary>"Active", "Bench" or "Prospect". Required.</summary>
        public string NewStatus { get; set; } = string.Empty;
    }

    /// <summary>
    /// Body of POST /api/AdminTrade/finalize. The commissioner sends
    /// the full trade shape (players with optional status overrides,
    /// picks) plus any solo status adjustments on players who are
    /// staying on their team, and the chosen effective date; the
    /// backend validates, applies, and returns the persisted
    /// TradeHistoryDto.
    /// </summary>
    public class FinalizeTradeRequest
    {
        public int TeamAId { get; set; }
        public int TeamBId { get; set; }

        /// <summary>
        /// UTC instant (day precision is applied server-side). This
        /// is the date the trade and any accompanying status changes
        /// take effect on.
        /// </summary>
        public DateTime EffectiveAt { get; set; }

        public string? Note { get; set; }

        /// <summary>Players leaving Team A (going to Team B), with
        /// optional status overrides on the destination team.</summary>
        public List<TradePlayerRequest> TeamASendingPlayers { get; set; } = new();

        /// <summary>Players leaving Team B (going to Team A), with
        /// optional status overrides on the destination team.</summary>
        public List<TradePlayerRequest> TeamBSendingPlayers { get; set; } = new();

        /// <summary>
        /// Solo status changes for players staying on Team A (not
        /// traded). Applied at the same effective date as the trade.
        /// </summary>
        public List<TradeExtraStatusChangeRequest> TeamAExtraStatusChanges { get; set; } = new();

        /// <summary>
        /// Solo status changes for players staying on Team B (not
        /// traded). Applied at the same effective date as the trade.
        /// </summary>
        public List<TradeExtraStatusChangeRequest> TeamBExtraStatusChanges { get; set; } = new();

        /// <summary>Draft picks moving from Team A to Team B.</summary>
        public List<int> TeamASendingDraftPickIds { get; set; } = new();

        /// <summary>Draft picks moving from Team B to Team A.</summary>
        public List<int> TeamBSendingDraftPickIds { get; set; } = new();
    }

    /// <summary>One player side of a trade, as frozen in the snapshot.</summary>
    public class AdminTradePlayerSideDto
    {
        public int PlayerId { get; set; }
        public int NhlPlayerId { get; set; }
        public string FirstName { get; set; } = string.Empty;
        public string LastName { get; set; } = string.Empty;
        public string Position { get; set; } = string.Empty;
        public string NhlTeamAbbreviation { get; set; } = string.Empty;
        public decimal Salary { get; set; }
        public int YearsRemaining { get; set; }

        /// <summary>
        /// Status the player held on his old team before the trade.
        /// Empty for snapshots written before the status-override
        /// feature shipped.
        /// </summary>
        public string PreviousStatus { get; set; } = string.Empty;

        /// <summary>
        /// Status the player holds on his new team after the trade.
        /// Equal to PreviousStatus when the admin did not change the
        /// status as part of the trade. Empty for old snapshots.
        /// </summary>
        public string NewStatus { get; set; } = string.Empty;
    }

    /// <summary>One draft pick side of a trade, as frozen in the snapshot.</summary>
    public class AdminTradePickSideDto
    {
        public int DraftPickId { get; set; }
        public int DraftYear { get; set; }
        public int Round { get; set; }
        public string OriginalOwnerFantasyTeamName { get; set; } = string.Empty;
    }

    /// <summary>
    /// JSON payload stored in TradeHistory.SnapshotJson. Contains
    /// everything needed to display or reconstruct the trade
    /// without any additional DB lookup.
    /// </summary>
    public class TradeSnapshotPayload
    {
        public int TeamAId { get; set; }
        public string TeamAName { get; set; } = string.Empty;
        public int TeamBId { get; set; }
        public string TeamBName { get; set; } = string.Empty;
        public DateTime EffectiveAt { get; set; }

        public List<AdminTradePlayerSideDto> TeamASentPlayers { get; set; } = new();
        public List<AdminTradePlayerSideDto> TeamBSentPlayers { get; set; } = new();
        public List<AdminTradePickSideDto> TeamASentPicks { get; set; } = new();
        public List<AdminTradePickSideDto> TeamBSentPicks { get; set; } = new();

        /// <summary>
        /// Solo status changes on players staying on Team A.
        /// PreviousStatus / NewStatus on each entry describe the
        /// transition. Empty for trades that had no solo adjustments.
        /// </summary>
        public List<AdminTradePlayerSideDto> TeamAExtraStatusChanges { get; set; } = new();

        /// <summary>
        /// Solo status changes on players staying on Team B.
        /// </summary>
        public List<AdminTradePlayerSideDto> TeamBExtraStatusChanges { get; set; } = new();
    }

    /// <summary>Full trade row returned to the admin page.</summary>
    public class TradeHistoryDto
    {
        public int Id { get; set; }
        public int SeasonId { get; set; }
        public string SeasonName { get; set; } = string.Empty;

        public int TeamAId { get; set; }
        public string TeamAName { get; set; } = string.Empty;

        public int TeamBId { get; set; }
        public string TeamBName { get; set; } = string.Empty;

        public DateTime EffectiveAt { get; set; }
        public DateTime ConfirmedAt { get; set; }
        public string? Note { get; set; }

        public List<AdminTradePlayerSideDto> TeamASentPlayers { get; set; } = new();
        public List<AdminTradePlayerSideDto> TeamBSentPlayers { get; set; } = new();
        public List<AdminTradePickSideDto> TeamASentPicks { get; set; } = new();
        public List<AdminTradePickSideDto> TeamBSentPicks { get; set; } = new();

        /// <summary>Solo status changes applied to players staying
        /// on Team A as part of this trade.</summary>
        public List<AdminTradePlayerSideDto> TeamAExtraStatusChanges { get; set; } = new();

        /// <summary>Solo status changes applied to players staying
        /// on Team B as part of this trade.</summary>
        public List<AdminTradePlayerSideDto> TeamBExtraStatusChanges { get; set; } = new();

        /// <summary>
        /// Chronological audit trail of every date change made on this
        /// trade (oldest first). Empty when the trade was never
        /// re-dated. The FIRST entry's PreviousEffectiveAt is the
        /// originally-recorded date; the last entry's NewEffectiveAt
        /// matches EffectiveAt.
        /// </summary>
        public List<TradeDateChangeDto> DateChanges { get; set; } = new();
    }

    /// <summary>
    /// Result of POST /api/AdminTrade/finalize.
    /// </summary>
    public class FinalizeTradeResultDto
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
        public TradeHistoryDto? TradeHistory { get; set; }
    }

    /// <summary>
    /// Body of PATCH /api/AdminTrade/history/{tradeId}/date.
    /// </summary>
    public class ChangeTradeDateRequest
    {
        /// <summary>
        /// New effective instant (day precision applied server-side).
        /// Must differ from the current one.
        /// </summary>
        public DateTime NewEffectiveAt { get; set; }

        /// <summary>Optional free-text reason. Max length 500.</summary>
        public string? Reason { get; set; }
    }

    /// <summary>One date change entry on a trade's audit trail.</summary>
    public class TradeDateChangeDto
    {
        public int Id { get; set; }
        public DateTime PreviousEffectiveAt { get; set; }
        public DateTime NewEffectiveAt { get; set; }
        public DateTime ChangedAt { get; set; }
        public string? Reason { get; set; }
    }

    /// <summary>Result of PATCH /api/AdminTrade/history/{tradeId}/date.</summary>
    public class ChangeTradeDateResultDto
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
        public TradeHistoryDto? TradeHistory { get; set; }
    }

    /// <summary>
    /// Result of DELETE /api/AdminTrade/history/{tradeId}. On success
    /// the trade is completely erased (TradeHistory, TradeDateChange,
    /// and all linked RosterStatusHistory rows), players and picks are
    /// back on their original teams, and a recompute is queued.
    /// </summary>
    public class RevertTradeResultDto
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
    }
}