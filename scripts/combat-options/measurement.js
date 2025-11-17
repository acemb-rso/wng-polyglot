import {
  COVER_DIFFICULTY_VALUES,
  SIZE_AVERAGE_INDEX,
  SIZE_ENGAGEMENT_SEQUENCE,
  SIZE_MODIFIER_OPTIONS,
  SIZE_OPTION_KEYS
} from "./constants.js";

export function getActorCombatSize(actor) {
  if (!actor) return "average";
  const size = actor.system?.combat?.size ?? actor.system?.size ?? actor.size;
  return normalizeSizeKey(size);
}

export function getTokenCombatSize(token) {
  if (!token) return "average";
  const actor = token.actor ?? token.document?.actor;
  return getActorCombatSize(actor);
}

export function getEngagementRangeForSize(sizeKey) {
  const idx = SIZE_ENGAGEMENT_SEQUENCE.indexOf(sizeKey);
  if (idx < 0) return 1.5;
  const distanceFromAverage = Math.abs(SIZE_AVERAGE_INDEX - idx);
  return Math.max(1.5, 1.5 + (distanceFromAverage * 1.5));
}

export function normalizeCoverKey(value) {
  if (value === undefined || value === null) return "";
  const str = String(value).trim().toLowerCase();
  if (!str) return "";
  if (COVER_DIFFICULTY_VALUES[str] === undefined) return "";
  return str;
}

export function getCoverDifficulty(value) {
  const key = normalizeCoverKey(value);
  return COVER_DIFFICULTY_VALUES[key] ?? 0;
}

export function getCoverLabel(value) {
  const key = normalizeCoverKey(value);
  if (key === "half") return "WNGCE.Cover.Half";
  if (key === "full") return "WNGCE.Cover.Full";
  return null;
}

export function getTokenEngagementRange(token) {
  const size = getTokenCombatSize(token);
  return getEngagementRangeForSize(size);
}

export function getTokenDisposition(token) {
  if (!token) return 0;
  const disposition = token.document?.disposition ?? token.document?._source?.disposition ?? token.disposition ?? null;
  if (Number.isFinite(disposition)) return disposition;
  return 0;
}

export function tokenIsDefeated(token) {
  if (!token) return false;
  const actor = token.actor ?? token.document?.actor ?? null;
  return Boolean(actor?.hasCondition?.("defeated"));
}

export function getTokenRadius(token, measurement) {
  if (!token) return null;
  const width = Number(token.document?.width ?? token.document?._source?.width ?? token.w);
  const distance = Number(measurement?.gridDistance ?? canvas?.scene?.dimensions?.distance);
  if (!Number.isFinite(width) || !Number.isFinite(distance) || width <= 0 || distance <= 0) return null;
  const units = width * distance;
  if (!Number.isFinite(units)) return null;
  return units / 2;
}

export function measureTokenDistance(tokenA, tokenB, measurement) {
  if (!tokenA || !tokenB) return null;
  if (tokenA === tokenB) return 0;

  const distance = measurement?.gridDistance ?? canvas?.scene?.dimensions?.distance ?? null;
  const size = measurement?.gridSize ?? canvas?.scene?.dimensions?.size ?? null;

  if (!Number.isFinite(distance) || !Number.isFinite(size) || distance <= 0 || size <= 0) {
    return null;
  }

  const tokenAData = tokenA.document?._source ?? tokenA.document ?? tokenA.data ?? {};
  const tokenBData = tokenB.document?._source ?? tokenB.document ?? tokenB.data ?? {};

  const dx = (tokenAData.x ?? 0) - (tokenBData.x ?? 0);
  const dy = (tokenAData.y ?? 0) - (tokenBData.y ?? 0);
  const distPx = Math.hypot(dx, dy) / size;
  const dist = distPx * distance;
  if (!Number.isFinite(dist) || dist < 0) {
    return null;
  }

  return dist;
}

export function measureTokenEdgeDistance(tokenA, tokenB, measurement) {
  if (!tokenA || !tokenB) return null;
  const rawDistance = measureTokenDistance(tokenA, tokenB, measurement);
  if (!Number.isFinite(rawDistance)) return null;

  const tokenARadius = getTokenRadius(tokenA, measurement);
  const tokenBRadius = getTokenRadius(tokenB, measurement);

  if (!Number.isFinite(tokenARadius) || !Number.isFinite(tokenBRadius)) return null;
  return Math.max(0, rawDistance - tokenARadius - tokenBRadius);
}

export function tokensAreEngaged(tokenA, tokenB, measurement) {
  const range = getTokenEngagementRange(tokenA);
  const dist = measureTokenEdgeDistance(tokenA, tokenB, measurement);
  if (!Number.isFinite(range) || !Number.isFinite(dist)) return false;
  return dist <= range;
}

export function getCanvasMeasurementContext() {
  const distance = canvas?.scene?.dimensions?.distance;
  const size = canvas?.scene?.dimensions?.size;
  if (!Number.isFinite(distance) || !Number.isFinite(size) || distance <= 0 || size <= 0) {
    return null;
  }

  const unitPerPixel = distance / size;
  if (!Number.isFinite(unitPerPixel) || unitPerPixel <= 0) {
    return null;
  }

  const pxPerUnit = 1 / unitPerPixel;
  if (!Number.isFinite(pxPerUnit) || pxPerUnit <= 0) {
    return null;
  }

  return {
    unitPerPixel,
    pxPerUnit,
    bucketSizePx: size,
    gridDistance: distance
  };
}

export function buildEngagementTokenData(token, measurement) {
  if (!token?.id) return null;
  const center = token.center;
  if (!center) return null;

  const x = Number(center.x);
  const y = Number(center.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const range = getTokenEngagementRange(token);
  const rawRangePx = measurement?.pxPerUnit ? range * measurement.pxPerUnit : null;
  const rangePx = Number.isFinite(rawRangePx) && rawRangePx >= 0 ? rawRangePx : null;

  const radius = getTokenRadius(token, measurement);
  const rawRadiusPx = measurement?.pxPerUnit ? radius * measurement.pxPerUnit : null;
  const radiusPx = Number.isFinite(rawRadiusPx) && rawRadiusPx >= 0 ? rawRadiusPx : null;

  const bucketSizePx = measurement?.bucketSizePx;
  const bucketX = bucketSizePx ? Math.floor(x / bucketSizePx) : null;
  const bucketY = bucketSizePx ? Math.floor(y / bucketSizePx) : null;

  return {
    token,
    id: token.id,
    x,
    y,
    range,
    rangePx,
    radius,
    radiusPx,
    bucketX: Number.isFinite(bucketX) ? bucketX : null,
    bucketY: Number.isFinite(bucketY) ? bucketY : null
  };
}

export function collectEngagedTokenIds(friendlyTokens, hostileTokens, measurement) {
  const engagedTokenIds = new Set();
  if (!friendlyTokens.length || !hostileTokens.length) return engagedTokenIds;

  const friendlyData = friendlyTokens
    .map((token) => buildEngagementTokenData(token, measurement))
    .filter(Boolean);
  const hostileData = hostileTokens
    .map((token) => buildEngagementTokenData(token, measurement))
    .filter(Boolean);

  if (!friendlyData.length || !hostileData.length) {
    return engagedTokenIds;
  }

  const canBucket = Boolean(measurement?.pxPerUnit && measurement?.bucketSizePx);
  const friendBucketed = canBucket && friendlyData.every((entry) => Number.isFinite(entry.bucketX) && Number.isFinite(entry.bucketY));
  const hostileBucketed = canBucket && hostileData.every((entry) => Number.isFinite(entry.bucketX) && Number.isFinite(entry.bucketY));

  if (friendBucketed && hostileBucketed) {
    const bucketSizePx = measurement.bucketSizePx;
    const pxPerUnit = measurement.pxPerUnit;

    let maxReachPx = 0;
    let maxRadiusPx = 0;
    for (const entry of [...friendlyData, ...hostileData]) {
      const entryRangePx = Number.isFinite(entry.rangePx) ? entry.rangePx : (Number.isFinite(entry.range) ? entry.range * pxPerUnit : 0);
      const entryRadiusPx = Number.isFinite(entry.radiusPx) ? entry.radiusPx : (Number.isFinite(entry.radius) ? entry.radius * pxPerUnit : 0);

      if (Number.isFinite(entryRadiusPx) && entryRadiusPx > maxRadiusPx) {
        maxRadiusPx = entryRadiusPx;
      }

      const reachPx = (Number.isFinite(entryRangePx) ? entryRangePx : 0) + (Number.isFinite(entryRadiusPx) ? entryRadiusPx : 0);
      if (Number.isFinite(reachPx) && reachPx > maxReachPx) {
        maxReachPx = reachPx;
      }
    }

    const bucketRadius = Math.max(0, Math.ceil((maxReachPx + maxRadiusPx) / bucketSizePx));
    const hostileBuckets = new Map();

    for (const hostile of hostileData) {
      const key = `${hostile.bucketX},${hostile.bucketY}`;
      const bucket = hostileBuckets.get(key);
      if (bucket) {
        bucket.push(hostile);
      } else {
        hostileBuckets.set(key, [hostile]);
      }
    }

    for (const friendly of friendlyData) {
      for (let bx = friendly.bucketX - bucketRadius; bx <= friendly.bucketX + bucketRadius; bx++) {
        for (let by = friendly.bucketY - bucketRadius; by <= friendly.bucketY + bucketRadius; by++) {
          const candidates = hostileBuckets.get(`${bx},${by}`);
          if (!candidates?.length) continue;

          for (const hostile of candidates) {
            const baseThreshold = Math.max(friendly.range, hostile.range);
            if (!Number.isFinite(baseThreshold) || baseThreshold < 0) continue;

            const expandedThreshold = baseThreshold
              + (Number.isFinite(friendly.radius) ? friendly.radius : 0)
              + (Number.isFinite(hostile.radius) ? hostile.radius : 0);
            if (!Number.isFinite(expandedThreshold) || expandedThreshold <= 0) continue;

            const thresholdPx = expandedThreshold * pxPerUnit;
            const dx = hostile.x - friendly.x;
            const dy = hostile.y - friendly.y;

            if (Math.abs(dx) > thresholdPx || Math.abs(dy) > thresholdPx) continue;
            if ((dx * dx + dy * dy) > (thresholdPx * thresholdPx)) continue;

            if (!tokensAreEngaged(friendly.token, hostile.token, measurement)) continue;

            engagedTokenIds.add(friendly.id);
            engagedTokenIds.add(hostile.id);
          }
        }
      }
    }

    if (engagedTokenIds.size) {
      return engagedTokenIds;
    }
  }

  for (const friendly of friendlyData) {
    for (const hostile of hostileData) {
      if (tokensAreEngaged(friendly.token, hostile.token, measurement)) {
        engagedTokenIds.add(friendly.id);
        engagedTokenIds.add(hostile.id);
      }
    }
  }

  return engagedTokenIds;
}

export function normalizeSizeKey(size) {
  if (!size) return "average";
  const key = String(size).trim().toLowerCase();
  if (!key) return "average";
  return SIZE_OPTION_KEYS.has(key) ? key : "average";
}
