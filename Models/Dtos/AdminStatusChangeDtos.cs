namespace NhlFantasyLeague.api.Models.Dtos
{
    /// <summary>
    /// Body of POST /api/AdminStatusChange/finalize. The commissioner
    /// sends the batch of status pairs to swap, both status names, and
    /// the effective date.
    /// </summary>
    public class FinalizeStatusChangeRequest
    {
        public int FantasyTeamId { get; set; }
        public DateTime EffectiveAt { get; set; }

        /// <summary>"Active", "Bench" or "Prospect".</summary>
        public string StatusA { get; set; } = string.Empty;

        /// <summary>"Active", "Bench" or "Prospect".</summary>
        public string StatusB { get; set; } = string.Empty;

        public string? Note { get; set; }

        public List<StatusChangePairRequest> Pairs { get; set; } = new();
    }

    public class StatusChangePairRequest
    {
        /// <summary>Player currently holding StatusA (will get StatusB).</summary>
        public int? StatusASidePlayerId { get; set; }

        /// <summary>Player currently holding StatusB (will get StatusA).</summary>
        public int? StatusBSidePlayerId { get; set; }
    }

    /// <summary>One player side of a status change, as frozen in the snapshot.</summary>
    public class AdminStatusChangePlayerSideDto
    {
        public int PlayerId { get; set; }
        public int NhlPlayerId { get; set; }
        public string FirstName { get; set; } = string.Empty;
        public string LastName { get; set; } = string.Empty;
        public string Position { get; set; } = string.Empty;
        public string NhlTeamAbbreviation { get; set; } = string.Empty;

        /// <summary>Status held BEFORE the change.</summary>
        public string PreviousStatusName { get; set; } = string.Empty;

        /// <summary>Status held AFTER the change.</summary>
        public string NewStatusName { get; set; } = string.Empty;
    }

    /// <summary>One paired slot of a status change (A-side ↔ B-side).</summary>
    public class StatusChangePairDto
    {
        public int SlotIndex { get; set; }
        public AdminStatusChangePlayerSideDto StatusASide { get; set; } = new();
        public AdminStatusChangePlayerSideDto StatusBSide { get; set; } = new();
    }

    /// <summary>JSON payload stored in StatusChangeHistory.SnapshotJson.</summary>
    public class StatusChangeSnapshotPayload
    {
        public int FantasyTeamId { get; set; }
        public string FantasyTeamName { get; set; } = string.Empty;
        public string StatusAName { get; set; } = string.Empty;
        public string StatusBName { get; set; } = string.Empty;
        public DateTime EffectiveAt { get; set; }

        public List<StatusChangePairDto> Pairs { get; set; } = new();
    }

    /// <summary>One date change entry on a status change's audit trail.</summary>
    public class StatusChangeDateChangeDto
    {
        public int Id { get; set; }
        public DateTime PreviousEffectiveAt { get; set; }
        public DateTime NewEffectiveAt { get; set; }
        public DateTime ChangedAt { get; set; }
        public string? Reason { get; set; }
    }

    /// <summary>Full status change row returned to the admin page.</summary>
    public class StatusChangeHistoryDto
    {
        public int Id { get; set; }
        public int SeasonId { get; set; }
        public string SeasonName { get; set; } = string.Empty;

        public int FantasyTeamId { get; set; }
        public string FantasyTeamName { get; set; } = string.Empty;

        public string StatusAName { get; set; } = string.Empty;
        public string StatusBName { get; set; } = string.Empty;

        public DateTime EffectiveAt { get; set; }
        public DateTime ConfirmedAt { get; set; }
        public string? Note { get; set; }

        public List<StatusChangePairDto> Pairs { get; set; } = new();
        public List<StatusChangeDateChangeDto> DateChanges { get; set; } = new();
    }

    /// <summary>Result of POST /api/AdminStatusChange/finalize.</summary>
    public class FinalizeStatusChangeResultDto
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
        public StatusChangeHistoryDto? StatusChangeHistory { get; set; }
    }

    /// <summary>Body of PATCH /api/AdminStatusChange/history/{id}/date.</summary>
    public class ChangeStatusChangeDateRequest
    {
        public DateTime NewEffectiveAt { get; set; }
        public string? Reason { get; set; }
    }

    /// <summary>Result of PATCH /api/AdminStatusChange/history/{id}/date.</summary>
    public class ChangeStatusChangeDateResultDto
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
        public StatusChangeHistoryDto? StatusChangeHistory { get; set; }
    }

    /// <summary>Result of DELETE /api/AdminStatusChange/history/{id}.</summary>
    public class RevertStatusChangeResultDto
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
    }
}