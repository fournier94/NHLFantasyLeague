namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// Lifecycle of a marketplace response. A response is recorded by
    /// a manager who answered another manager's offer. It stays
    /// Pending until the league acts on it.
    /// </summary>
    public enum TradeOfferResponseStatus
    {
        /// <summary>Response recorded, waiting for the offer creator.</summary>
        Pending = 0,

        /// <summary>Offer creator accepted the response.</summary>
        Accepted = 1,

        /// <summary>Offer creator declined the response.</summary>
        Rejected = 2,

        /// <summary>Responding manager retracted the response.</summary>
        Cancelled = 3,
    }
}