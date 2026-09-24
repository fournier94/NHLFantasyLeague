import * as Logos from 'react-nhl-logos';
import React from 'react';

interface LogoProps {
    size?: number;
}

export const nhlLogoMap: Record<
    string,
    React.ComponentType<LogoProps>
> = {
    ANA: Logos.ANA,
    BOS: Logos.BOS,
    BUF: Logos.BUF,
    CAR: Logos.CAR,
    CBJ: Logos.CBJ,
    CGY: Logos.CGY,
    CHI: Logos.CHI,
    COL: Logos.COL,
    DAL: Logos.DAL,
    DET: Logos.DET,
    EDM: Logos.EDM,
    FLA: Logos.FLA,
    LAK: Logos.LAK,
    MIN: Logos.MIN,
    MTL: Logos.MTL,
    NJD: Logos.NJD,
    NSH: Logos.NSH,
    NYI: Logos.NYI,
    NYR: Logos.NYR,
    OTT: Logos.OTT,
    PHI: Logos.PHI,
    PIT: Logos.PIT,
    SEA: Logos.SEA,
    SJS: Logos.SJS,
    STL: Logos.STL,
    TBL: Logos.TBL,
    TOR: Logos.TOR,
    VAN: Logos.VAN,
    VGK: Logos.VGK,
    WPG: Logos.WPG,
    WSH: Logos.WSH,
};