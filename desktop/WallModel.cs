using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;

namespace Saturday {
    public interface IGamePlayer {
        bool Loaded { get; }
        bool Muted { get; set; }
    }

    public sealed class WallController {
        readonly IGamePlayer[] players;
        public int Count { get; private set; }
        public int Main { get; private set; }
        public int Audio { get; private set; }
        public bool EqualGrid { get; set; }
        public event Action Changed;

        public WallController(IGamePlayer[] players) {
            this.players = players; Count = 7; Main = 0; Audio = -1;
        }
        public void Notify() { if (Changed != null) Changed(); }
        public void SetCount(int count) {
            if (count < 1 || count > players.Length) throw new ArgumentException("Choose 1 to 9 boxes.");
            if (players.Skip(count).Any(p => p.Loaded)) throw new InvalidOperationException("Clear games in the extra slots before reducing the box count.");
            Count = count; if (Main >= count) Main = 0; Notify();
        }
        public void MakeMain(int id) { Validate(id); Main = id; Notify(); }
        public void Listen(int id) {
            if (id != -1) { Validate(id); if (!players[id].Loaded) throw new InvalidOperationException("Load a game into that box first."); }
            // Mute every old source before enabling the selected player.
            Audio = -1;
            foreach (var player in players) player.Muted = true;
            if (id >= 0) { players[id].Muted = false; Audio = id; }
            Notify();
        }
        public void Cleared(int id) { if (Audio == id) Listen(-1); else Notify(); }
        void Validate(int id) { if (id < 0 || id >= Count) throw new ArgumentOutOfRangeException("id"); }
    }

    public static class WallLayout {
        public static Dictionary<int, Rectangle> Calculate(Rectangle area, int count, int main, bool equal) {
            if (count < 1 || count > 9 || main < 0 || main >= count) throw new ArgumentException("Invalid wall layout.");
            var result = new Dictionary<int, Rectangle>();
            int gap = 6;
            if (equal || count == 1) {
                int columns = count == 1 ? 1 : count <= 4 ? 2 : 3;
                int rows = (int)Math.Ceiling(count / (double)columns);
                for (int i = 0; i < count; i++) result[i] = Cell(area, i % columns, i / columns, columns, rows, gap);
            } else {
                int mainHeight = Math.Max(1, (area.Height - gap) / 2);
                result[main] = new Rectangle(area.X, area.Y, area.Width, mainHeight);
                var rest = Enumerable.Range(0, count).Where(id => id != main).ToArray();
                int columns = rest.Length <= 3 ? rest.Length : rest.Length <= 6 ? 3 : 4;
                int rows = (int)Math.Ceiling(rest.Length / (double)columns);
                var lower = new Rectangle(area.X, area.Y + mainHeight + gap, area.Width, Math.Max(1, area.Height - mainHeight - gap));
                for (int i = 0; i < rest.Length; i++) result[rest[i]] = Cell(lower, i % columns, i / columns, columns, rows, gap);
            }
            return result;
        }
        static Rectangle Cell(Rectangle area, int column, int row, int columns, int rows, int gap) {
            double width = (area.Width - gap * (columns - 1)) / (double)columns;
            double height = (area.Height - gap * (rows - 1)) / (double)rows;
            int left = (int)Math.Round(column * (width + gap));
            int top = (int)Math.Round(row * (height + gap));
            int right = (int)Math.Round(column * (width + gap) + width);
            int bottom = (int)Math.Round(row * (height + gap) + height);
            return new Rectangle(area.X + left, area.Y + top, Math.Max(1, right - left), Math.Max(1, bottom - top));
        }
    }

    public static class GameLinks {
        public static Uri Parse(string input) {
            string text = (input ?? "").Trim();
            if (text.Length == 0) throw new ArgumentException("Paste a game link first.");
            if (!text.Contains(":")) text = "https://" + text;
            Uri uri;
            if (!Uri.TryCreate(text, UriKind.Absolute, out uri) ||
                (uri.Scheme != "https" && !(uri.Scheme == "http" && uri.IsLoopback)) ||
                string.IsNullOrEmpty(uri.Host) || !string.IsNullOrEmpty(uri.UserInfo))
                throw new ArgumentException("Use an HTTPS game-page link, such as https://www.disneyplus.com/ or https://www.dazn.com/.");
            return uri;
        }
    }
}
