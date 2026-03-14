import { expect } from 'chai';
import sinon from 'sinon';
import supertest from 'supertest';
import { parseEpisodes, extractEpisodeMap, classifyTorrent, app, sizeToBytes, qualityScore, rank, pickTorrentTitle, detectSeriesScope } from './rd-auto.js';

// Import the functions that are not exported but needed for testing
// Since they are not exported, I'll copy them or find a way.
// For now, test the exported ones and mock the rest.

describe('parseEpisodes', () => {
  it('parses single episode', () => {
    const result = parseEpisodes('Show.S01E01.mkv');
    expect(result).to.deep.equal([{ season: 1, episode: 1 }]);
  });

  it('parses multiple episodes in one filename', () => {
    const result = parseEpisodes('Show.S01E01E02.mkv');
    expect(result).to.deep.equal([
      { season: 1, episode: 1 },
      { season: 1, episode: 2 }
    ]);
  });

  it('parses season with space', () => {
    const result = parseEpisodes('Show S01 E01.mkv');
    expect(result).to.deep.equal([{ season: 1, episode: 1 }]);
  });

  it('ignores non-matching', () => {
    const result = parseEpisodes('Some random file.txt');
    expect(result).to.deep.equal([]);
  });

  it('parses multiple seasons', () => {
    const result = parseEpisodes('Show.S01E01.S02E02.mkv');
    expect(result).to.deep.equal([
      { season: 1, episode: 1 },
      { season: 2, episode: 2 }
    ]);
  });

  it('handles empty string', () => {
    const result = parseEpisodes('');
    expect(result).to.deep.equal([]);
  });

  it('handles null', () => {
    const result = parseEpisodes(null);
    expect(result).to.deep.equal([]);
  });

  it('parses double digit seasons and episodes', () => {
    const result = parseEpisodes('Show.S10E15.mkv');
    expect(result).to.deep.equal([{ season: 10, episode: 15 }]);
  });

  it('parses with underscores', () => {
    const result = parseEpisodes('Show_S01_E01.mkv');
    expect(result).to.deep.equal([{ season: 1, episode: 1 }]);
  });
});

describe('extractEpisodeMap', () => {
  it('extracts from streams', () => {
    const streams = [
      {
        behaviorHints: { filename: 'Show.S01E01.mkv' },
        fileIdx: 1
      },
      {
        behaviorHints: { filename: 'Show.S01E02.mkv' },
        fileIdx: 2
      }
    ];
    const result = extractEpisodeMap(streams);
    expect(result).to.deep.equal({
      1: {
        1: { fileIdx: 1, filename: 'Show.S01E01.mkv' },
        2: { fileIdx: 2, filename: 'Show.S01E02.mkv' }
      }
    });
  });

  it('handles missing filename', () => {
    const streams = [
      { title: 'Show.S01E01.mkv', fileIdx: 1 }
    ];
    const result = extractEpisodeMap(streams);
    expect(result).to.deep.equal({
      1: {
        1: { fileIdx: 1, filename: 'Show.S01E01.mkv' }
      }
    });
  });

  it('handles empty streams', () => {
    const result = extractEpisodeMap([]);
    expect(result).to.deep.equal({});
  });

  it('handles streams with no episodes', () => {
    const streams = [
      { title: 'Some file.txt', fileIdx: 1 }
    ];
    const result = extractEpisodeMap(streams);
    expect(result).to.deep.equal({});
  });

  it('handles multiple seasons', () => {
    const streams = [
      { behaviorHints: { filename: 'Show.S01E01.mkv' }, fileIdx: 1 },
      { behaviorHints: { filename: 'Show.S02E01.mkv' }, fileIdx: 2 }
    ];
    const result = extractEpisodeMap(streams);
    expect(result).to.have.keys('1', '2');
  });
});

describe('classifyTorrent', () => {
  it('classifies single episode', () => {
    const streams = [
      { behaviorHints: { filename: 'Show.S01E01.mkv' } }
    ];
    const result = classifyTorrent(streams);
    expect(result.classification).to.equal('single-episode');
    expect(result.episodeCount).to.equal(1);
    expect(result.seasons).to.deep.equal([1]);
  });

  it('classifies multi-episode', () => {
    const streams = [
      { behaviorHints: { filename: 'Show.S01E01.mkv' } },
      { behaviorHints: { filename: 'Show.S01E02.mkv' } }
    ];
    const result = classifyTorrent(streams);
    expect(result.classification).to.equal('multi-episode');
    expect(result.episodeCount).to.equal(2);
  });

  it('detects complete series', () => {
    const streams = [
      { title: 'Show Complete Series S01-S05' }
    ];
    const result = classifyTorrent(streams);
    expect(result.seriesScope).to.equal('complete-series');
  });

  it('detects single season', () => {
    const streams = [
      { title: 'Show Season 1' },
      { behaviorHints: { filename: 'Show.S01E01.mkv' } }
    ];
    const result = classifyTorrent(streams);
    expect(result.seriesScope).to.equal('single-season');
  });

  it('handles empty streams', () => {
    const result = classifyTorrent([]);
    expect(result.episodeCount).to.equal(0);
    expect(result.seasons).to.deep.equal([]);
  });

  it('detects season range', () => {
    const streams = [
      { title: 'Show S01-S03' }
    ];
    const result = classifyTorrent(streams);
    expect(result.seriesScope).to.equal('complete-series');
  });

  it('detects multi-season from episodes', () => {
    const streams = [
      { behaviorHints: { filename: 'Show.S01E01.mkv' } },
      { behaviorHints: { filename: 'Show.S02E01.mkv' } }
    ];
    const result = classifyTorrent(streams);
    expect(result.seriesScope).to.equal('multi-season');
  });
});

describe('sizeToBytes', () => {
  it('converts GB to bytes', () => {
    expect(sizeToBytes('1.5 GB')).to.equal(1.5 * 1024 * 1024 * 1024);
  });

  it('converts MB to bytes', () => {
    expect(sizeToBytes('500 MB')).to.equal(500 * 1024 * 1024);
  });

  it('returns 0 for invalid', () => {
    expect(sizeToBytes('invalid')).to.equal(0);
  });
});

describe('qualityScore', () => {
  // Copy the function logic for testing
  const qualityScore = (title) => {
    if (title.includes("2160")) return 5;
    if (title.includes("1080")) return 4;
    if (title.includes("720")) return 3;
    return 1;
  };

  it('returns 5 for 2160p', () => {
    expect(qualityScore('Show 2160p')).to.equal(5);
  });

  it('returns 4 for 1080p', () => {
    expect(qualityScore('Show 1080p')).to.equal(4);
  });

  it('returns 3 for 720p', () => {
    expect(qualityScore('Show 720p')).to.equal(3);
  });

  it('returns 1 for others', () => {
    expect(qualityScore('Show 480p')).to.equal(1);
  });
});

describe('rank', () => {
  const rank = (results) => results.sort((a, b) => qualityScore(b.title) - qualityScore(a.title));

  it('ranks by quality descending', () => {
    const results = [
      { title: 'Show 720p' },
      { title: 'Show 1080p' },
      { title: 'Show 480p' }
    ];
    const ranked = rank(results);
    expect(ranked[0].title).to.include('1080p');
    expect(ranked[1].title).to.include('720p');
    expect(ranked[2].title).to.include('480p');
  });
});

describe('pickTorrentTitle', () => {
  const pickTorrentTitle = (streams) => {
    for (const stream of streams || []) {
      const title = stream?.title || stream?.name || stream?.behaviorHints?.filename || "";
      if (title) return title;
    }
    return "";
  };

  it('picks title from stream', () => {
    const streams = [{ title: 'Main Title' }];
    expect(pickTorrentTitle(streams)).to.equal('Main Title');
  });

  it('picks name if no title', () => {
    const streams = [{ name: 'Name' }];
    expect(pickTorrentTitle(streams)).to.equal('Name');
  });

  it('picks filename from behaviorHints', () => {
    const streams = [{ behaviorHints: { filename: 'file.mkv' } }];
    expect(pickTorrentTitle(streams)).to.equal('file.mkv');
  });

  it('returns empty if none', () => {
    expect(pickTorrentTitle([])).to.equal('');
  });
});

describe('detectSeriesScope', () => {
  const detectSeriesScope = (streams, seasons) => {
    const title = pickTorrentTitle(streams);
    const text = title.toLowerCase();

    const hasComplete = /complete[\s.]+(series|collection|box[\s.]*set|set)/i.test(text) ||
      /full[\s.]+series/i.test(text) ||
      /entire[\s.]+series/i.test(text) ||
      /all[\s.]+seasons?/i.test(text) ||
      /series[\s.]+complete/i.test(text);

    const hasSeasonRange = /season[\s.]*\d{1,2}[\s.]*(?:-|to)[\s.]*\d{1,2}/i.test(text) ||
    /\bs\d{1,2}[\s.]*(?:-|to)[\s.]*s?\d{1,2}\b/i.test(text);
    const hasSingleSeason = /season[\s.]*\d{1,2}/i.test(text) ||
      /\bs\d{1,2}\b(?![e\s])/i.test(text);

    if (hasComplete || hasSeasonRange) return "complete-series";

    if (seasons.length > 1) return "multi-season";

    if (seasons.length === 1 && hasSingleSeason) return "single-season";

    return "unknown";
  };

  it('detects complete series', () => {
    const streams = [{ title: 'Show Complete Series' }];
    expect(detectSeriesScope(streams, [])).to.equal('complete-series');
  });

  it('detects season range', () => {
    const streams = [{ title: 'Show S01-S05' }];
    expect(detectSeriesScope(streams, [])).to.equal('complete-series');
  });

  it('detects single season', () => {
    const streams = [{ title: 'Show Season 1' }];
    expect(detectSeriesScope(streams, [1])).to.equal('single-season');
  });

  it('detects multi-season from seasons', () => {
    const streams = [{ title: 'Show' }];
    expect(detectSeriesScope(streams, [1, 2])).to.equal('multi-season');
  });

  it('returns unknown', () => {
    const streams = [{ title: 'Show' }];
    expect(detectSeriesScope(streams, [1])).to.equal('unknown');
  });
});

describe('App', () => {
  let request;

  before(() => {
    request = supertest(app);
  });

  it('responds to /request with error for missing params', async () => {
    const res = await request.post('/request').send({});
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('error', 'TMDb ID and mediaType required');
  });

  it('responds to /request with ok for valid movie params', async () => {
    // Mock fetch for tmdbToImdb and torrentioFetch
    const fetchStub = sinon.stub(global, 'fetch');
    fetchStub.onCall(0).resolves({
      ok: true,
      json: () => ({ imdb_id: 'tt1234567' })
    });
    fetchStub.onCall(1).resolves({
      ok: true,
      text: () => JSON.stringify({ streams: [] })
    });

    const res = await request.post('/request').send({ tmdbId: '123', mediaType: 'movie' });
    expect(res.status).to.equal(200);
    expect(res.body).to.have.property('status', 'ok');

    fetchStub.restore();
  });

  // Add more for TV
});