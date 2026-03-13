import express from "express"
import fetch from "node-fetch"

const RD_TOKEN = process.env.RD_TOKEN || ""
const TMDB_API_KEY = process.env.TMDB_API_KEY || ""

const MOVIE_LIMIT_GB = Number(process.env.MOVIE_LIMIT_GB || "15")
const EP_LIMIT_GB = Number(process.env.EP_LIMIT_GB || "7")

const MOVIE_LIMIT = MOVIE_LIMIT_GB * 1024 * 1024 * 1024 // default 15 GB
const EP_LIMIT = EP_LIMIT_GB * 1024 * 1024 * 1024       // default 7 GB

const app = express();
app.use(express.json());

// ----------------------- Helpers -----------------------

function sizeToBytes(title) {
  const m = title.match(/([\d.]+)\s*(GB|MB)/i);
  if (!m) return 0;
  return m[2].toUpperCase() === "GB"
    ? parseFloat(m[1]) * 1024 * 1024 * 1024
    : parseFloat(m[1]) * 1024 * 1024;
}

function qualityScore(title) {
  if (title.includes("2160")) return 5;
  if (title.includes("1080")) return 4;
  if (title.includes("720")) return 3;
  return 1;
}

function rank(results) {
  return results.sort((a, b) => qualityScore(b.title) - qualityScore(a.title));
}

async function torrentioFetch(url) {
  console.log("Fetching torrents from Torrentio:", url);
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log("Torrentio fetch failed with status:", res.status);
      return [];
    }
    const text = await res.text();
    if (!text) {
      console.log("Torrentio returned empty response");
      return [];
    }
    const data = JSON.parse(text);
    if (!data.streams) {
      console.log("Torrentio response has no streams");
      return [];
    }
    const streams = data.streams.map(s => ({
      title: s.title,
      hash: s.infoHash,
      magnet: `magnet:?xt=urn:btih:${s.infoHash}`,
      size: sizeToBytes(s.title),
    }));
    console.log(`Fetched ${streams.length} torrents from Torrentio`);
    return streams;
  } catch (e) {
    console.log("Torrentio fetch failed:", e);
    return [];
  }
}

async function rdCache(hash) {
  console.log("Checking RD cache for hash:", hash);
  try {
    const res = await fetch(
      `https://api.real-debrid.com/rest/1.0/torrents/instantAvailability/${hash}`,
      { headers: { Authorization: `Bearer ${RD_TOKEN}` } }
    );
    const data = await res.json();
    const isCached = Object.keys(data).length > 0;
    console.log(`Hash ${hash} is ${isCached ? 'cached' : 'not cached'} in RD`);
    return isCached;
  } catch (e) {
    console.log("RD cache check failed:", e);
    return false;
  }
}

async function rdList() {
  console.log("Listing RD torrents");
  try {
    const res = await fetch(
      `https://api.real-debrid.com/rest/1.0/torrents`,
      { headers: { Authorization: `Bearer ${RD_TOKEN}` } }
    );
    const torrents = await res.json();
    console.log(`Found ${torrents.length} torrents in RD`);
    return torrents;
  } catch (e) {
    console.log("RD list fetch failed:", e);
    return [];
  }
}

async function alreadyAdded(hash) {
  console.log("Checking if torrent already added:", hash);
  const torrents = await rdList();
  const isAdded = torrents.some(t => t.hash === hash);
  console.log(`Torrent ${hash} is ${isAdded ? 'already added' : 'not added'} to RD`);
  return isAdded;
}

async function addAndDownload(magnet) {
  console.log("Adding magnet to RD:", magnet);
  try {
    const addRes = await fetch(
      "https://api.real-debrid.com/rest/1.0/torrents/addMagnet",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RD_TOKEN}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `magnet=${encodeURIComponent(magnet)}`,
      }
    );

    const data = await addRes.json();
    if (!data.id) {
      console.log("Failed to add magnet, no ID returned");
      return false;
    }

    console.log(`Added magnet, torrent ID: ${data.id}`);

    await fetch(
      `https://api.real-debrid.com/rest/1.0/torrents/selectFiles/${data.id}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RD_TOKEN}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "files=all",
      }
    );

    console.log("Successfully selected all files for torrent:", data.id);
    return true;
  } catch (e) {
    console.log("RD add/download failed:", e);
    return false;
  }
}

async function tmdbToImdb(tmdbId, mediaType) {
  console.log(`Converting TMDb ID ${tmdbId} (${mediaType}) to IMDb ID`);
  try {
    // Use TMDb external IDs endpoints for a clean IMDb ID
    // Movies: https://developer.themoviedb.org/reference/movie-external-ids
    // TV:     https://developer.themoviedb.org/reference/tv-series-external-ids
    const url =
      mediaType === "movie"
        ? `https://api.themoviedb.org/3/movie/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`
        : `https://api.themoviedb.org/3/tv/${tmdbId}/external_ids?api_key=${TMDB_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    console.log("TMDb external_ids response:", data);
    console.log(`IMDb ID for TMDb ${tmdbId}: ${data.imdb_id || 'not found'}`);
    return data.imdb_id;
  } catch (e) {
    console.log("TMDb → IMDb conversion failed:", e);
    return null;
  }
}

// ----------------------- Movie/TV Processing -----------------------

async function processMovie(tmdbId) {
  console.log("Processing movie request for TMDb ID:", tmdbId);
  const imdbId = await tmdbToImdb(tmdbId, "movie");
  if (!imdbId) {
    console.log("No IMDb ID found for movie TMDb ID:", tmdbId);
    return null;
  }

  const url = `https://torrentio.strem.fun/stream/movie/${imdbId}.json`;
  const results = await torrentioFetch(url);
  if (!results.length) {
    console.log("No torrents found for movie IMDb ID:", imdbId);
    return null;
  }

  console.log(`Checking cache for ${results.length} torrents`);
  const cached = [];
  for (const r of results) {
    if (await rdCache(r.hash)) cached.push(r);
  }
  console.log(`${cached.length} torrents are cached in RD`);

  const filtered = cached.filter(r => r.size && r.size <= MOVIE_LIMIT);
  console.log(`${filtered.length} torrents pass size filter (≤15GB)`);
  const ranked = rank(filtered);

  for (const r of ranked) {
    console.log(`Trying torrent: ${r.title}`);
    if (await alreadyAdded(r.hash)) {
      console.log("Torrent already added, skipping");
      continue;
    }
    if (await addAndDownload(r.magnet)) {
      console.log("Successfully added movie torrent:", r.title);
      return r;
    }
  }

  console.log("No suitable movie torrent found for TMDb ID:", tmdbId);
  return null;
}

async function processEpisode(tmdbId, season, episode) {
  console.log("Processing TV episode request for TMDb ID:", tmdbId, "Season:", season, "Episode:", episode);
  const imdbId = await tmdbToImdb(tmdbId, "tv");
  if (!imdbId) {
    console.log("No IMDb ID found for TV TMDb ID:", tmdbId);
    return null;
  }

  // Season pack
  const seasonUrl = `https://torrentio.strem.fun/stream/series/${imdbId}:${season}.json`;
  const seasonResults = await torrentioFetch(seasonUrl);
  const seasonPacks = seasonResults.filter(s => !s.title.match(/E\d{2}/));
  console.log(`Found ${seasonPacks.length} season packs`);

  for (const r of rank(seasonPacks)) {
    console.log(`Trying season pack: ${r.title}`);
    if (await alreadyAdded(r.hash)) {
      console.log("Season pack already added, skipping");
      continue;
    }
    if (!(await rdCache(r.hash))) {
      console.log("Season pack not cached, skipping");
      continue;
    }
    if (await addAndDownload(r.magnet)) {
      console.log("Successfully added season pack:", r.title);
      return r;
    }
  }

  // Single episode
  const epUrl = `https://torrentio.strem.fun/stream/series/${imdbId}:${season}:${episode}.json`;
  const epResults = await torrentioFetch(epUrl);
  const filtered = epResults.filter(r => r.size && r.size <= EP_LIMIT);
  console.log(`Found ${filtered.length} single episodes passing size filter (≤7GB)`);

  for (const r of rank(filtered)) {
    console.log(`Trying episode: ${r.title}`);
    if (await alreadyAdded(r.hash)) {
      console.log("Episode already added, skipping");
      continue;
    }
    if (!(await rdCache(r.hash))) {
      console.log("Episode not cached, skipping");
      continue;
    }
    if (await addAndDownload(r.magnet)) {
      console.log("Successfully added episode torrent:", r.title);
      return r;
    }
  }

  console.log("No suitable episode torrent found for TMDb ID:", tmdbId, "S:", season, "E:", episode);
  return null;
}

async function processAllEpisodes(tmdbId, seasonNumbers) {
  for (const season of seasonNumbers) {
    let totalEpisodes = 1;
    try {
      const url = `https://api.themoviedb.org/3/tv/${tmdbId}/season/${season}?api_key=${TMDB_API_KEY}`;
      const res = await fetch(url);
      const data = await res.json();
      totalEpisodes = data.episodes?.length || 1;
    } catch (e) {
      console.log(`Failed to fetch season ${season} metadata:`, e);
    }

    for (let ep = 1; ep <= totalEpisodes; ep++) {
      const result = await processEpisode(tmdbId, season, ep);
      if (result) console.log(`Added episode S${season}E${ep}: ${result.title}`);
    }
  }
}

// ----------------------- Webhook -----------------------

app.post("/request", async (req, res) => {
  const { tmdbId, tvdbId, mediaType, extra} = req.body;
  console.log("Incoming request:", { tmdbId, mediaType, extra, tvdbId });

  if (!tmdbId || !mediaType)
    return res.json({ error: "TMDb ID and mediaType required" });

  let seasonNumbers = [];

  if (mediaType === "tv" && Array.isArray(extra)) {
    const seasonField = extra.find(e => e.name === "Requested Seasons");
    if (seasonField && seasonField.value) {
      seasonNumbers = seasonField.value.split(",").map(s => parseInt(s.trim()));
      console.log("Parsed season numbers:", seasonNumbers);
    }
  }

  try {
    if (mediaType === "tv") {
      if (!seasonNumbers.length) seasonNumbers = [1];
      console.log("Processing seasons:", seasonNumbers);
      await processAllEpisodes(tmdbId, seasonNumbers);
    } else {
      console.log("Processing movie");
      await processMovie(tmdbId);
    }
    res.json({ status: "ok" });
  } catch (e) {
    console.log("Error processing request:", e);
    res.json({ error: e.message });
  }
});

app.listen(3000, () => console.log("RD automation running on port 3000"));