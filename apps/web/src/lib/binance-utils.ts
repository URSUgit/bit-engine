const BINANCE_SYMBOL_MAP: Record<string, string> = {
  BTC: "BTCUSDT", ETH: "ETHUSDT", SOL: "SOLUSDT", BNB: "BNBUSDT",
  XRP: "XRPUSDT", ADA: "ADAUSDT", DOGE: "DOGEUSDT", AVAX: "AVAXUSDT",
  MATIC: "MATICUSDT", DOT: "DOTUSDT", LINK: "LINKUSDT", LTC: "LTCUSDT",
  ATOM: "ATOMUSDT", UNI: "UNIUSDT", ARB: "ARBUSDT", OP: "OPUSDT",
};

export function toBinanceSymbol(s: string): string {
  const upper = s.toUpperCase().replace(/-USD$/, "").replace(/USDT$/, "");
  return BINANCE_SYMBOL_MAP[upper] ?? `${upper}USDT`;
}
