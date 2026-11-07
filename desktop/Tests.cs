using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;

namespace Saturday {
    static class NativeTests {
        sealed class Player : IGamePlayer {
            public bool Loaded { get; set; }
            bool muted = true;
            readonly int id;
            readonly List<string> log;
            public Player(int id, List<string> log) { this.id = id; this.log = log; }
            public bool Muted { get { return muted; } set { muted = value; log.Add(id + ":" + value); } }
        }
        static int passed;
        static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
        static void Test(string name, Action action) { action(); passed++; Console.WriteLine("PASS " + name); }
        static void Main() {
            try {
                Test("Three-box sketch: full-width main above two smaller players", delegate {
                    var area = new Rectangle(0, 0, 1920, 1080); var boxes = WallLayout.Calculate(area, 3, 0, false);
                    Check(boxes[0].Width == area.Width, "main width"); Check(boxes[1].Y > boxes[0].Bottom, "main above second"); Check(boxes[2].Left > boxes[1].Right, "two supporting players side by side");
                });
                Test("Quad, penta, seven and nine boxes fit without overlap", delegate {
                    foreach (int count in new int[] { 4, 5, 7, 9 }) foreach (bool grid in new bool[] { false, true }) {
                        var area = new Rectangle(-1920, -200, 1920, 1080); var boxes = WallLayout.Calculate(area, count, count - 1, grid);
                        Check(boxes.Count == count, "missing box");
                        foreach (var box in boxes.Values) Check(area.Contains(box) && box.Width > 0 && box.Height > 0, "box outside monitor");
                        for (int i = 0; i < count; i++) for (int j = i + 1; j < count; j++) Check(!boxes[i].IntersectsWith(boxes[j]), "overlapping players");
                    }
                });
                Test("Controller mutes all old players before selecting new audio", delegate {
                    var log = new List<string>(); var players = Enumerable.Range(0, 9).Select(i => new Player(i, log) { Loaded = true }).ToArray(); var model = new WallController(players);
                    model.Listen(1); log.Clear(); model.Listen(6);
                    Check(model.Audio == 6, "wrong audio source"); Check(log.Last() == "6:False", "new source not last"); Check(log.Take(9).All(s => s.EndsWith(":True")), "previous players must be muted first"); Check(players.Count(p => !p.Muted) == 1, "more than one audio source");
                });
                Test("Changing main game and layout preserves independent audio", delegate {
                    var log = new List<string>(); var players = Enumerable.Range(0, 9).Select(i => new Player(i, log) { Loaded = true }).ToArray(); var model = new WallController(players);
                    model.Listen(1); log.Clear(); model.MakeMain(6); model.EqualGrid = true; model.Notify();
                    Check(model.Main == 6 && model.Audio == 1, "main/audio coupled"); Check(log.Count == 0, "layout changed audio");
                });
                Test("Clearing the listening player mutes the wall", delegate {
                    var log = new List<string>(); var players = Enumerable.Range(0, 9).Select(i => new Player(i, log) { Loaded = true }).ToArray(); var model = new WallController(players);
                    model.Listen(3); players[3].Loaded = false; model.Cleared(3); Check(model.Audio == -1 && players.All(p => p.Muted), "cleared source retained sound");
                });
                Test("Reducing boxes cannot hide a loaded game", delegate {
                    var log = new List<string>(); var players = Enumerable.Range(0, 9).Select(i => new Player(i, log)).ToArray(); var model = new WallController(players); players[6].Loaded = true;
                    bool rejected = false; try { model.SetCount(3); } catch (InvalidOperationException) { rejected = true; } Check(rejected && model.Count == 7, "loaded game hidden");
                    players[6].Loaded = false; model.MakeMain(6); model.SetCount(3); Check(model.Count == 3 && model.Main == 0, "main not reset");
                });
                Test("Bad source selection preserves the current sound", delegate {
                    var log = new List<string>(); var players = Enumerable.Range(0, 9).Select(i => new Player(i, log)).ToArray(); players[0].Loaded = true; var model = new WallController(players); model.Listen(0); log.Clear();
                    bool rejected = false; try { model.Listen(2); } catch (InvalidOperationException) { rejected = true; } Check(rejected && model.Audio == 0 && log.Count == 0, "bad selection changed audio");
                });
                Test("Direct game links accept HTTPS and reject executable schemes", delegate {
                    Check(GameLinks.Parse("www.disneyplus.com/watch/example").Scheme == "https", "missing HTTPS prefix"); Check(GameLinks.Parse("https://www.dazn.com/en-MX/home").Host == "www.dazn.com", "DAZN link rejected");
                    foreach (string link in new string[] { "javascript:alert(1)", "file:///C:/Windows/win.ini", "https://user:secret@example.com/", "http://example.com/" }) {
                        bool rejected = false; try { GameLinks.Parse(link); } catch (ArgumentException) { rejected = true; } Check(rejected, "unsafe scheme accepted");
                    }
                });
                Console.WriteLine(passed + " native controller checks passed.");
            } catch (Exception error) { Console.Error.WriteLine("FAIL " + error.Message); Environment.ExitCode = 1; }
        }
    }
}
