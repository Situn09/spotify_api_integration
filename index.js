import express from "express";
import axios from "axios";
import open from "open";
import dotenv from "dotenv";
import qs from "querystring";

dotenv.config();

function reloadEnv() {
  const envConfig = dotenv.parse(fs.readFileSync(".env"));
  for (const k in envConfig) {
    process.env[k] = envConfig[k];
  }
}

const app = express();
const PORT = process.env.PORT || 8888;

const clientId = process.env.SPOTIFY_CLIENT_ID;
const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
const redirectUri =
  process.env.SPOTIFY_REDIRECT_URI || "http://localhost:8888/callback";

let accessToken = null;

// --------- AUTHORIZATION FLOW (one-time) ----------
const scopes = [
  "user-read-currently-playing",
  "user-top-read",
  "user-modify-playback-state",
  "user-read-playback-state",
].join(" ");

const authUrl = `https://accounts.spotify.com/authorize?response_type=code&client_id=${clientId}&scope=${encodeURIComponent(
  scopes
)}&redirect_uri=${encodeURIComponent(redirectUri)}`;

import fs from "fs";
import path from "path";

app.get("/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.send("Authorization failed or canceled.");

  try {
    const response = await axios.post(
      "https://accounts.spotify.com/api/token",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    const { access_token, refresh_token } = response.data;

    console.log("\n✅ Access Token:", access_token);
    console.log("🔄 Refresh Token:", refresh_token);

    // Automatically save to .env
    const envPath = path.resolve(process.cwd(), ".env");
    let envContents = "";
    if (fs.existsSync(envPath)) {
      envContents = fs.readFileSync(envPath, "utf-8");
      if (envContents.includes("SPOTIFY_REFRESH_TOKEN")) {
        envContents = envContents.replace(
          /SPOTIFY_REFRESH_TOKEN=.*/g,
          `SPOTIFY_REFRESH_TOKEN=${refresh_token}`
        );
      } else {
        envContents += `\nSPOTIFY_REFRESH_TOKEN=${refresh_token}`;
      }
    } else {
      envContents = `SPOTIFY_REFRESH_TOKEN=${refresh_token}`;
    }

    fs.writeFileSync(envPath, envContents);
    reloadEnv();
    console.log("💾 Refresh token saved to .env");

    res.send(
      `<h2>✅ Authorization Successful!</h2><p>Refresh token saved. You can close this tab.</p>`
    );
  } catch (error) {
    console.error(
      "❌ Error exchanging code:",
      error.response?.data || error.message
    );
    res.send("Error getting tokens. Check the console.");
  }
});

// --------- TOKEN HANDLING ----------
async function getAccessToken() {
  const res = await axios.post(
    "https://accounts.spotify.com/api/token",
    qs.stringify({
      grant_type: "refresh_token",
      refresh_token: process.env.SPOTIFY_REFRESH_TOKEN,
    }),
    {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${clientId}:${clientSecret}`).toString("base64"),
        "Content-Type": "application/x-www-form-urlencoded",
      },
    }
  );
  accessToken = res.data.access_token;
}

async function spotifyGet(url) {
  if (!accessToken) await getAccessToken();
  try {
    return await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    if (err.response?.status === 401) {
      accessToken = null;
      return spotifyGet(url);
    }
    throw err;
  }
}

// --------- /SPOTIFY ROUTES ----------
app.get("/spotify", async (req, res) => {
  try {
    const devices = await spotifyGet(
      "https://api.spotify.com/v1/me/player/devices"
    );
    console.log("Available Devices:", devices.data.devices);
    const playbackInfo = await axios.get(
      "https://api.spotify.com/v1/me/player",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    console.log("Playback Info:", playbackInfo.data);
    const [topRes, nowRes] = await Promise.all([
      spotifyGet("https://api.spotify.com/v1/me/top/tracks?limit=10"),
      spotifyGet("https://api.spotify.com/v1/me/player/currently-playing"),
    ]);

    const topTracks = topRes.data.items.map((track) => ({
      id: track.id,
      name: track.name,
      artist: track.artists[0].name,
      play_url: `/spotify/play/${track.id}`,
    }));

    let nowPlaying = null;
    if (nowRes.data && nowRes.data.item) {
      const track = nowRes.data.item;
      nowPlaying = {
        name: track.name,
        artist: track.artists[0].name,
        url: track.external_urls.spotify,
      };
    }

    res.json({
      now_playing: nowPlaying,
      top_tracks: topTracks,
      controls: {
        stop_url: "/spotify/stop",
      },
    });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: "Something went wrong" });
  }
});

app.get("/spotify/stop", async (req, res) => {
  await getAccessToken();
  try {
    await axios.put("https://api.spotify.com/v1/me/player/pause", null, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    res.json({ success: true });
  } catch (err) {
    console.log(err.response.data);
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: err.response.data.error.reason });
  }
});

app.post("/spotify/play/:id", async (req, res) => {
  await getAccessToken();
  await axios.put(
    "https://api.spotify.com/v1/me/player/play",
    { uris: [`spotify:track:${req.params.id}`] },
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  res.json({ success: true });
});

// --------- START SERVER ----------
app.listen(PORT, () => {
  console.log(
    `✅ Server running at ${redirectUri.replace("/callback", "")}/spotify`
  );
  if (!process.env.SPOTIFY_REFRESH_TOKEN) {
    console.log("🚀 Opening browser for Spotify authorization...");
    open(authUrl).catch(console.error);
  }
});
