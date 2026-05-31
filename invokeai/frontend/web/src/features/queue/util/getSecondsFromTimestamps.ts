const TIMEZONE_PATTERN = /(Z|[+-]\d{2}:?\d{2})$/i;

export const getTimestampMillis = (timestamp: string | null | undefined) => {
  if (!timestamp) {
    return null;
  }

  const trimmed = timestamp.trim();
  if (!trimmed) {
    return null;
  }

  const isoLike = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const timestampWithTimezone = TIMEZONE_PATTERN.test(isoLike) ? isoLike : `${isoLike}Z`;
  const normalizedPrecision = timestampWithTimezone.replace(/(\.\d{3})\d+(?=Z|[+-]\d{2}:?\d{2}$)/, '$1');
  const millis = Date.parse(normalizedPrecision);

  return Number.isFinite(millis) ? millis : null;
};

export const getSecondsFromTimestamps = (start: string, end: string) => {
  const startMillis = getTimestampMillis(start);
  const endMillis = getTimestampMillis(end);

  if (startMillis === null || endMillis === null) {
    return 0;
  }

  return Number(((endMillis - startMillis) / 1000).toFixed(2));
};
