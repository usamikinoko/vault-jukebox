/*
 * Pure-logic tests: filename parsing, formatting, extension handling.
 *
 * The modules under test import nothing from `obsidian`, so they are bundled
 * straight from source with esbuild and required — no shims, no fake DOM. The
 * assertions are about invariants ("a title with underscores survives the round
 * trip"), not about magic numbers.
 */

const assert = require("assert");
const os = require("os");
const path = require("path");
const esbuild = require("esbuild");

function bundle(relative) {
  const out = path.join(os.tmpdir(), `mp-${path.basename(relative)}.cjs`);
  esbuild.buildSync({
    entryPoints: [path.join(__dirname, "..", "src", relative)],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "es2018",
    outfile: out,
    logLevel: "silent",
  });
  return require(out);
}

const P = bundle("parse.ts");
const A = bundle("audioFormats.ts");

let passed = 0;
function check(label, actual, expected) {
  assert.deepStrictEqual(actual, expected, `${label}\n  got      ${JSON.stringify(actual)}\n  expected ${JSON.stringify(expected)}`);
  passed++;
}
function ok(label, condition) {
  assert.ok(condition, label);
  passed++;
}

// ---------------------------------------------------------- filename parsing

check("plain name has no artist", P.parseTrackName("song"), { title: "song", artist: "" });
check("title_artist splits", P.parseTrackName("Song_Artist"), { title: "Song", artist: "Artist" });
check("splits on the LAST underscore", P.parseTrackName("A_B_C"), { title: "A_B", artist: "C" });
check("lone leading underscore is not an artist split", P.parseTrackName("_x"), {
  title: "_x",
  artist: "",
});
check("lone trailing underscore is not an artist split", P.parseTrackName("x_"), {
  title: "x_",
  artist: "",
});
check("cjK names split the same way", P.parseTrackName("夜的第七章_周杰伦"), {
  title: "夜的第七章",
  artist: "周杰伦",
});
ok(
  "the title never contains the separator that was split on",
  !P.parseTrackName("A_B_C").title.endsWith("_")
);

// ------------------------------------------------------------------ formatting

check("seconds", P.formatTime(5), "0:05");
check("minutes", P.formatTime(75), "1:15");
check("hours", P.formatTime(3725), "1:02:05");
check("NaN is 0:00", P.formatTime(NaN), "0:00");
check("negative is 0:00", P.formatTime(-3), "0:00");
check("Infinity is 0:00", P.formatTime(Infinity), "0:00");

check("bytes", P.formatSize(512), "512 B");
check("kilobytes", P.formatSize(2048), "2.0 KB");
check("megabytes", P.formatSize(3.5 * 1024 * 1024), "3.5 MB");
check("hundreds of megabytes round", P.formatSize(120 * 1024 * 1024), "120 MB");

// --------------------------------------------------------------- unique names

{
  const taken = new Set(["a.mp3"]);
  check("free name is kept", P.uniqueName("b", "mp3", (n) => taken.has(n)), "b.mp3");
  check("collision gets a suffix", P.uniqueName("a", "mp3", (n) => taken.has(n)), "a (2).mp3");
  taken.add("a (2).mp3");
  check("second collision steps again", P.uniqueName("a", "mp3", (n) => taken.has(n)), "a (3).mp3");
  check("empty base falls back", P.uniqueName("", "mp3", () => false), "track.mp3");
  check("no extension is allowed", P.uniqueName("x", "", () => false), "x");
}

// -------------------------------------------------------------- file names

ok("ordinary name is valid", P.isValidFileName("夜曲_周杰伦"));
ok("slash is rejected", !P.isValidFileName("a/b"));
ok("colon is rejected", !P.isValidFileName("a:b"));
ok("empty is rejected", !P.isValidFileName(""));

// ------------------------------------------------------- natural comparison

ok("track2 sorts before track10", P.naturalCompare("track2", "track10") < 0);
ok("case is ignored", P.naturalCompare("Apple", "banana") < 0);
ok("identical strings compare equal", P.naturalCompare("x", "x") === 0);
{
  const list = ["t10", "t2", "t1"].sort(P.naturalCompare);
  check("a natural sort orders the list", list, ["t1", "t2", "t10"]);
}

// ---------------------------------------------------------------- extensions

ok("mp3 is decodable", A.isPlayableExt("mp3"));
ok("flac is decodable", A.isPlayableExt("flac"));
ok("uppercase still decodable", A.isPlayableExt("FLAC"));
ok("leading dot is tolerated", A.isPlayableExt(".mp3"));
ok("wma is not decodable", !A.isPlayableExt("wma"));
ok("ape is not decodable", !A.isPlayableExt("ape"));

ok(
  "the default list is the union of both",
  A.DEFAULT_AUDIO_EXTENSIONS.length ===
    A.DECODABLE_EXTENSIONS.length + A.UNDECODABLE_EXTENSIONS.length
);
ok("no extension appears in both lists", !A.DECODABLE_EXTENSIONS.some((e) => A.UNDECODABLE_EXTENSIONS.includes(e)));

check("a comma-separated list parses", A.parseExtensionList("mp3, .FLAC  wav", []), [
  "mp3",
  "flac",
  "wav",
]);
check("semicolons parse too", A.parseExtensionList("mp3;ogg", []), ["mp3", "ogg"]);
check("an empty field keeps the fallback", A.parseExtensionList("   ", ["mp3"]), ["mp3"]);

ok("audio name detection", A.isAudioName("a.mp3", ["mp3"]));
ok("uppercase extension detection", A.isAudioName("a.MP3", ["mp3"]));
ok("a dotfile is not an audio file", !A.isAudioName(".mp3", ["mp3"]));
ok("a note is not an audio file", !A.isAudioName("a.md", ["mp3"]));
ok("an extensionless name is rejected", !A.isAudioName("readme", ["mp3"]));

// ------------------------------------------------------------- types (pure)

const T = bundle("types.ts");
check("default music root is unset", T.DEFAULT_SETTINGS.musicRoot, "");
check("default seek step is 3s", T.DEFAULT_SETTINGS.seekStep, 3);
check("default loop mode is the playlist", T.DEFAULT_SETTINGS.loopMode, "all");
check("the default playlist is named default", T.DEFAULT_PLAYLIST, "default");
ok("flac is in the default extension list", T.DEFAULT_SETTINGS.audioExtensions.includes("flac"));

// --------------------------------------------------------- settings encoding

const S = bundle("settingSpec.ts");
{
  const spec = S.allSettings().find((s) => s.key === "musicRoot");
  ok("musicRoot has a spec", !!spec);
  check(
    "a typed path is trimmed of slashes",
    S.encodeSetting(spec, "  /01_Resources/music/  ", T.DEFAULT_SETTINGS),
    "01_Resources/music"
  );

  const exts = S.allSettings().find((s) => s.key === "audioExtensions");
  const encoded = S.encodeSetting(exts, "mp3, flac", T.DEFAULT_SETTINGS);
  check("extensions encode to an array", encoded, ["mp3", "flac"]);
  check(
    "blank extensions fall back instead of hiding every file",
    S.encodeSetting(exts, "", T.DEFAULT_SETTINGS),
    T.DEFAULT_SETTINGS.audioExtensions
  );
  check("extensions decode back to a string", S.decodeSetting(exts, ["mp3", "flac"]), "mp3, flac");

  const reset = S.defaultedSettings({
    ...T.DEFAULT_SETTINGS,
    musicRoot: "keep?/no",
    lastTrackPath: "m/a.mp3",
    lastPosition: 42,
  });
  check("reset drops the preference", reset.musicRoot, "");
  check("reset keeps the session position", reset.lastPosition, 42);
  check("reset keeps the last track", reset.lastTrackPath, "m/a.mp3");
}

// ------------------------------------------------------ settings off disk

/*
 * `normalizeSettings` is the only thing standing between a hand-edited
 * `data.json` and a plugin that misbehaves without an error message. Each case
 * below corresponds to a failure mode named in the function's own doc comment,
 * so if that comment grows a field this block should grow a case.
 */
{
  check("no data at all yields the defaults", T.normalizeSettings(null), T.DEFAULT_SETTINGS);
  check(
    "an empty object yields the defaults",
    T.normalizeSettings({}),
    T.DEFAULT_SETTINGS
  );
  check(
    "a pre-0.2.0 file without `rate` is upgraded, not left undefined",
    T.normalizeSettings({ volume: 0.5 }).rate,
    1
  );
  check("a missing extension list is refilled", T.normalizeSettings({}).audioExtensions.length > 0, true);

  // rate: NaN breaks `playbackRate`; a stray value breaks the menu's checkmark.
  check("a NaN rate is replaced", T.normalizeSettings({ rate: NaN }).rate, 1);
  check("a zero rate is replaced", T.normalizeSettings({ rate: 0 }).rate, 1);
  check("a negative rate is replaced", T.normalizeSettings({ rate: -3 }).rate, 1);
  check("an off-menu rate snaps to the nearest step", T.normalizeSettings({ rate: 1.7 }).rate, 1.5);
  check("  …and snapping goes down as well as up", T.normalizeSettings({ rate: 0.6 }).rate, 0.5);
  check("a rate already on the menu is left alone", T.normalizeSettings({ rate: 1.25 }).rate, 1.25);

  // volume: out of range makes `audio.volume = …` throw IndexSizeError.
  check("an over-range volume is clamped", T.normalizeSettings({ volume: 4 }).volume, 1);
  check("a negative volume is clamped", T.normalizeSettings({ volume: -1 }).volume, 0);
  check("a NaN volume falls back", T.normalizeSettings({ volume: NaN }).volume, 0.8);

  // motion: the loud one — an unknown value leaves `data-mp-motion` matching no
  // rule, which un-sets `--mp-dur` and invalidates every transition.
  check("an unknown motion level falls back", T.normalizeSettings({ motion: "loud" }).motion, "full");
  check("  …and the three real levels survive", [T.normalizeSettings({ motion: "none" }).motion, T.normalizeSettings({ motion: "reduced" }).motion], ["none", "reduced"]);

  check("an unknown loop mode falls back", T.normalizeSettings({ loopMode: "forever" }).loopMode, "all");
  check("an unknown sort key falls back", T.normalizeSettings({ sortKey: "colour" }).sortKey, "name");
  check("a NaN seek step falls back", T.normalizeSettings({ seekStep: NaN }).seekStep, 3);
  check("a negative seek step falls back", T.normalizeSettings({ seekStep: -3 }).seekStep, 3);
  check("a negative resume position is clipped", T.normalizeSettings({ lastPosition: -9 }).lastPosition, 0);

  check("a non-boolean toggle falls back", T.normalizeSettings({ showStatusBar: "yes" }).showStatusBar, true);
  check("a non-string path falls back", T.normalizeSettings({ musicRoot: 42 }).musicRoot, "");
  check("a non-array extension list falls back", T.normalizeSettings({ audioExtensions: "mp3" }).audioExtensions, T.DEFAULT_SETTINGS.audioExtensions);
  check("an empty extension list falls back", T.normalizeSettings({ audioExtensions: [] }).audioExtensions, T.DEFAULT_SETTINGS.audioExtensions);
  check(
    "extensions are lowercased and de-dotted for the comparison sites",
    T.normalizeSettings({ audioExtensions: [".MP3", " Flac "] }).audioExtensions,
    ["mp3", "flac"]
  );
  check(
    "duplicate extensions collapse",
    T.normalizeSettings({ audioExtensions: ["mp3", "mp3"] }).audioExtensions,
    ["mp3"]
  );
  check(
    "a list of only junk entries falls back",
    T.normalizeSettings({ audioExtensions: ["", 7, null] }).audioExtensions,
    T.DEFAULT_SETTINGS.audioExtensions
  );
  check(
    "the defaults are never mutated by a repair",
    (() => {
      T.normalizeSettings({ audioExtensions: ["only-ogg"], rate: 9e9, motion: "x" });
      return T.DEFAULT_SETTINGS.audioExtensions.length > 1 && T.DEFAULT_SETTINGS.rate === 1;
    })(),
    true
  );
}

console.log(`logic: ${passed} assertions passed`);
