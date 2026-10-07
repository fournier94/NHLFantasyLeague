namespace NhlFantasyLeague.api.Models
{
    public enum TradeOfferStatus
    {
        Active = 0,

        /// <summary>Closed by the creator after a trade was agreed.</summary>
        Closed = 1,

        /// <summary>Cancelled by the creator without a trade happening.</summary>
        Cancelled = 2,
    }
}