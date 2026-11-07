using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Saturday {
    static class Theme {
        public static readonly Color Background = Color.FromArgb(16, 22, 14);
        public static readonly Color Panel = Color.FromArgb(26, 37, 20);
        public static readonly Color Line = Color.FromArgb(58, 76, 45);
        public static readonly Color Text = Color.FromArgb(234, 240, 225);
        public static readonly Color Muted = Color.FromArgb(155, 174, 139);
        public static readonly Color Lime = Color.FromArgb(184, 239, 88);
        public static Button Button(string text, Action click, bool primary = false) {
            var button = new Button { Text = text, AutoSize = true, Height = 32, FlatStyle = FlatStyle.Flat, BackColor = primary ? Lime : Panel, ForeColor = primary ? Background : Text, Padding = new Padding(8, 3, 8, 3), Margin = new Padding(4), Font = new Font("Segoe UI", 9) };
            button.FlatAppearance.BorderColor = Line;
            button.Click += delegate { try { click(); } catch (Exception error) { MessageBox.Show(error.Message, "Saturday", MessageBoxButtons.OK, MessageBoxIcon.Information); } };
            return button;
        }
        public static Label Label(string text, float size = 10, Color? color = null) {
            return new Label { Text = text, AutoSize = true, ForeColor = color ?? Text, Font = new Font("Segoe UI", size), Margin = new Padding(5), TextAlign = ContentAlignment.MiddleLeft };
        }
        public static TextBox Input() { return new TextBox { BackColor = Background, ForeColor = Text, BorderStyle = BorderStyle.FixedSingle, Font = new Font("Segoe UI", 10), Dock = DockStyle.Fill, Margin = new Padding(5, 8, 5, 5) }; }
    }

    static class Program {
        public static readonly string DataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SaturdayMultibox");
        [STAThread]
        static void Main() {
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
            Application.ThreadException += delegate(object sender, System.Threading.ThreadExceptionEventArgs e) { MessageBox.Show(e.Exception.Message, "Saturday", MessageBoxButtons.OK, MessageBoxIcon.Error); };
            try {
                Directory.CreateDirectory(DataDirectory);
                CoreWebView2Environment.GetAvailableBrowserVersionString();
                Application.Run(new ControlCenter());
            } catch (Exception error) {
                MessageBox.Show("Saturday could not start. Microsoft Edge WebView2 Runtime and .NET Framework 4.8 are required.\n\n" + error.Message, "Saturday", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }

    public sealed class GameHost : Panel, IGamePlayer {
        readonly int id;
        readonly Func<Task<CoreWebView2Environment>> environment;
        readonly Action<int> focus;
        readonly Label header;
        readonly Label placeholder;
        readonly Panel content;
        WebView2 browser;
        Task initialization;
        readonly List<CoreWebView2Frame> frames = new List<CoreWebView2Frame>();
        bool loaded;
        bool muted = true;
        int revision;
        double volume = 1;
        public string GameName = "";
        public string Link = "";
        public string Status = "Paste a game link in the control center";
        public event Action Changed;
        public bool Loaded { get { return loaded; } }
        public bool Muted {
            get { return muted; }
            set { muted = value; if (loaded && browser != null && browser.CoreWebView2 != null) browser.CoreWebView2.IsMuted = value; }
        }
        public GameHost(int id, Func<Task<CoreWebView2Environment>> environment, Action<int> focus, Action<int> promote) {
            this.id = id; this.environment = environment; this.focus = focus;
            BackColor = Theme.Line; Padding = new Padding(2);
            header = new Label { Dock = DockStyle.Top, Height = 25, ForeColor = Theme.Text, BackColor = Theme.Panel, Font = new Font("Segoe UI", 9), TextAlign = ContentAlignment.MiddleLeft, Padding = new Padding(8, 0, 0, 0) };
            placeholder = new Label { Dock = DockStyle.Fill, Text = "Game " + (id + 1) + "\n\nPaste its link in the control center", Font = new Font("Segoe UI", 15), ForeColor = Theme.Muted, BackColor = Theme.Background, TextAlign = ContentAlignment.MiddleCenter };
            content = new Panel { Dock = DockStyle.Fill }; content.Controls.Add(placeholder);
            Controls.Add(content); Controls.Add(header);
            header.Click += delegate { if (Loaded) focus(id); };
            header.DoubleClick += delegate { promote(id); };
            RefreshHeader(false, false);
        }
        public void RefreshHeader(bool main, bool listening) {
            BackColor = listening ? Theme.Lime : Theme.Line;
            header.Text = (main ? "★ " : "") + (string.IsNullOrEmpty(GameName) ? "Game " + (id + 1) : GameName) + (listening ? "    • LISTENING" : "");
        }
        void Notify() { if (Changed != null) Changed(); }
        async Task Initialize() {
            var env = await environment();
            if (IsDisposed) return;
            browser = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Black };
            content.Controls.Add(browser); browser.BringToFront();
            browser.GotFocus += delegate { if (Loaded) focus(id); };
            await browser.EnsureCoreWebView2Async(env);
            if (IsDisposed) return;
            var core = browser.CoreWebView2;
            core.IsMuted = muted;
            core.NavigationStarting += delegate(object sender, CoreWebView2NavigationStartingEventArgs e) {
                Uri uri;
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out uri) || (uri.Scheme != "https" && uri.Scheme != "http" && e.Uri != "about:blank")) { e.Cancel = true; return; }
                Status = "Loading page…"; Notify();
            };
            core.NavigationCompleted += async delegate(object sender, CoreWebView2NavigationCompletedEventArgs e) {
                if (IsDisposed) return;
                Status = e.IsSuccess ? "Page loaded · start the game in the visualizer" : "Page could not load: " + e.WebErrorStatus;
                await ApplyVolume(); Notify();
            };
            core.ProcessFailed += delegate { Status = "Player stopped. Clear this slot and load the link again."; loaded = false; Notify(); };
            core.FrameCreated += delegate(object sender, CoreWebView2FrameCreatedEventArgs e) {
                var frame = e.Frame; frames.Add(frame); frame.Destroyed += delegate { frames.Remove(frame); };
            };
            core.NewWindowRequested += async delegate(object sender, CoreWebView2NewWindowRequestedEventArgs e) {
                var deferral = e.GetDeferral();
                e.Handled = true;
                Form popup = null;
                try {
                    popup = new Form { Text = "Saturday · Provider window", Width = 900, Height = 760, StartPosition = FormStartPosition.CenterParent };
                    var view = new WebView2 { Dock = DockStyle.Fill }; popup.Controls.Add(view); popup.Show(FindForm());
                    await view.EnsureCoreWebView2Async(env);
                    e.NewWindow = view.CoreWebView2;
                    view.CoreWebView2.WindowCloseRequested += delegate { popup.Close(); };
                } catch (Exception error) { if (popup != null) popup.Close(); Status = "Could not open provider window: " + error.Message; Notify(); }
                finally { deferral.Complete(); }
            };
            // This adjusts ordinary media volume only. Provider access and DRM stay with WebView2.
            await core.AddScriptToExecuteOnDocumentCreatedAsync("window.__saturdayVolume=1;new MutationObserver(function(){document.querySelectorAll('video,audio').forEach(function(m){m.volume=window.__saturdayVolume;});}).observe(document,{childList:true,subtree:true});");
        }
        public async Task LoadLink(string link) {
            var uri = GameLinks.Parse(link);
            int request = ++revision;
            Link = uri.AbsoluteUri;
            Status = "Opening game page…"; Notify();
            try {
                if (initialization == null) initialization = Initialize();
                await initialization;
                if (IsDisposed || request != revision || browser == null || browser.CoreWebView2 == null) return;
                Muted = muted;
                browser.CoreWebView2.Navigate(uri.AbsoluteUri); loaded = true; placeholder.Visible = false; Notify();
            } catch (Exception error) { Status = "Could not open player: " + error.Message; Notify(); throw; }
        }
        public void ReloadPage() { if (browser != null && browser.CoreWebView2 != null && Loaded) browser.CoreWebView2.Reload(); }
        public void Clear() {
            revision++; loaded = false; muted = true; initialization = null; frames.Clear();
            if (browser != null) { browser.Dispose(); browser = null; }
            placeholder.Visible = true; Status = "Game cleared · link kept in the controller"; Notify();
        }
        public async Task SetVolume(double value) { volume = Math.Max(0, Math.Min(1, value)); await ApplyVolume(); }
        async Task ApplyVolume() {
            if (browser == null || browser.CoreWebView2 == null || IsDisposed) return;
            string script = "window.__saturdayVolume=" + volume.ToString(CultureInfo.InvariantCulture) + ";document.querySelectorAll('video,audio').forEach(function(m){m.volume=window.__saturdayVolume;});";
            try { await browser.CoreWebView2.ExecuteScriptAsync(script); } catch { }
            foreach (var frame in frames.ToArray()) { try { await frame.ExecuteScriptAsync(script); } catch { } }
        }
    }

    public sealed class Visualizer : Form {
        readonly GameHost[] players;
        readonly WallController model;
        readonly Panel wall;
        readonly Button fullscreen;
        Rectangle restoreBounds;
        FormWindowState restoreState;
        bool isFullscreen;
        public bool ShuttingDown;
        public event Action VisibilityChanged;
        public Visualizer(GameHost[] players, WallController model) {
            this.players = players; this.model = model;
            Text = "Saturday · Visualizer"; BackColor = Color.Black; Width = 1400; Height = 900; MinimumSize = new Size(500, 350); StartPosition = FormStartPosition.Manual;
            var toolbar = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 40, BackColor = Theme.Background, WrapContents = false };
            toolbar.Controls.Add(Theme.Label("SATURDAY  /  VISUALIZER", 10, Theme.Lime));
            fullscreen = Theme.Button("Fullscreen", ToggleFullscreen); toolbar.Controls.Add(fullscreen);
            toolbar.Controls.Add(Theme.Button("Mute all", delegate { model.Listen(-1); }));
            toolbar.Controls.Add(Theme.Label("Click a player to listen · use the controller to change the main game", 9, Theme.Muted));
            wall = new Panel { Dock = DockStyle.Fill, BackColor = Color.Black };
            Controls.Add(wall); Controls.Add(toolbar); foreach (var player in players) wall.Controls.Add(player);
            wall.Resize += delegate { Arrange(); };
            model.Changed += Arrange;
            FormClosing += delegate(object sender, FormClosingEventArgs e) { if (!ShuttingDown && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; Hide(); if (VisibilityChanged != null) VisibilityChanged(); } };
        }
        public void Arrange() {
            if (IsDisposed || wall.ClientSize.Width < 80 || wall.ClientSize.Height < 80) return;
            var area = new Rectangle(6, 6, Math.Max(1, wall.ClientSize.Width - 12), Math.Max(1, wall.ClientSize.Height - 12));
            var bounds = WallLayout.Calculate(area, model.Count, model.Main, model.EqualGrid);
            wall.SuspendLayout();
            for (int i = 0; i < players.Length; i++) { players[i].Visible = i < model.Count; if (i < model.Count) players[i].Bounds = bounds[i]; players[i].RefreshHeader(i == model.Main, i == model.Audio); }
            wall.ResumeLayout();
        }
        public void ToggleFullscreen() {
            if (!Visible) Show();
            if (!isFullscreen) { restoreBounds = Bounds; restoreState = WindowState; WindowState = FormWindowState.Normal; FormBorderStyle = FormBorderStyle.None; Bounds = Screen.FromControl(this).Bounds; isFullscreen = true; }
            else { FormBorderStyle = FormBorderStyle.Sizable; WindowState = FormWindowState.Normal; Bounds = restoreBounds; WindowState = restoreState; isFullscreen = false; }
            fullscreen.Text = isFullscreen ? "Exit fullscreen" : "Fullscreen"; Arrange();
        }
        public void MoveTo(Screen screen) {
            if (isFullscreen) { Bounds = screen.Bounds; return; }
            WindowState = FormWindowState.Normal;
            var area = screen.WorkingArea;
            Bounds = new Rectangle(area.X + 15, area.Y + 15, Math.Max(500, area.Width - 30), Math.Max(350, area.Height - 30));
        }
        protected override bool ProcessCmdKey(ref Message msg, Keys keyData) {
            if (keyData == Keys.F11 || keyData == Keys.F) { ToggleFullscreen(); return true; }
            if (keyData == Keys.Escape && isFullscreen) { ToggleFullscreen(); return true; }
            return base.ProcessCmdKey(ref msg, keyData);
        }
    }

    public sealed class SavedLineup {
        public int Count = 7;
        public int Main = 0;
        public bool EqualGrid;
        public string[] Names = new string[9];
        public string[] Links = new string[9];
    }

    public sealed class ControlCenter : Form {
        readonly GameHost[] players = new GameHost[9];
        readonly TextBox[] links = new TextBox[9];
        readonly TextBox[] names = new TextBox[9];
        readonly Label[] statuses = new Label[9];
        readonly Button[] audioButtons = new Button[9];
        readonly Button[] mainButtons = new Button[9];
        readonly Panel[] rows = new Panel[9];
        readonly ComboBox count = new ComboBox();
        readonly ComboBox layout = new ComboBox();
        readonly ComboBox monitor = new ComboBox();
        readonly Label listening = Theme.Label("All games muted", 10, Theme.Lime);
        readonly Label feedback = Theme.Label("Paste a game link, then choose Load. Sign in inside the visualizer when asked.", 10, Theme.Muted);
        readonly CheckBox follow = new CheckBox { Text = "Audio follows player focus", Checked = true, AutoSize = true, ForeColor = Theme.Text, Margin = new Padding(10) };
        readonly WallController model;
        readonly Visualizer visualizer;
        Task<CoreWebView2Environment> environment;
        bool refreshing;
        bool closing;
        readonly string settingsFile = Path.Combine(Program.DataDirectory, "lineup.json");

        Task<CoreWebView2Environment> EnvironmentForPlayers() {
            if (environment == null) environment = CoreWebView2Environment.CreateAsync(null, Path.Combine(Program.DataDirectory, "BrowserProfile"));
            return environment;
        }
        public ControlCenter() {
            Text = "Saturday · Control center"; BackColor = Theme.Background; ForeColor = Theme.Text; Font = new Font("Segoe UI", 10); Width = 1320; Height = 940; MinimumSize = new Size(1050, 720); StartPosition = FormStartPosition.CenterScreen;
            for (int i = 0; i < 9; i++) players[i] = new GameHost(i, EnvironmentForPlayers, PlayerFocused, Promote);
            model = new WallController(players.Cast<IGamePlayer>().ToArray());
            visualizer = new Visualizer(players, model); visualizer.VisibilityChanged += RefreshControls;
            var shell = new TableLayoutPanel { Dock = DockStyle.Fill, RowCount = 5, ColumnCount = 1, Padding = new Padding(20) };
            shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 70)); shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 102)); shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 48)); shell.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); shell.RowStyles.Add(new RowStyle(SizeType.Absolute, 85));
            Controls.Add(shell);
            var heading = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight, WrapContents = false };
            heading.Controls.Add(Theme.Label("SATURDAY", 26, Theme.Lime)); heading.Controls.Add(Theme.Label("CONTROL CENTER  /  DIRECT PLAYBACK", 11, Theme.Muted)); shell.Controls.Add(heading, 0, 0);
            var tools = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = true };
            tools.Controls.Add(Theme.Button("Show visualizer", ShowVisualizer, true)); tools.Controls.Add(Theme.Button("Fullscreen visualizer", delegate { ShowVisualizer(); visualizer.ToggleFullscreen(); Focus(); }));
            monitor.DropDownStyle = ComboBoxStyle.DropDownList; monitor.Width = 210;
            foreach (var screen in Screen.AllScreens) monitor.Items.Add(screen.DeviceName + " · " + screen.Bounds.Width + "×" + screen.Bounds.Height);
            monitor.SelectedIndex = Screen.AllScreens.Length > 1 ? 1 : 0;
            tools.Controls.Add(monitor); tools.Controls.Add(Theme.Button("Move to monitor", delegate { ShowVisualizer(); visualizer.MoveTo(Screen.AllScreens[Math.Min(monitor.SelectedIndex, Screen.AllScreens.Length - 1)]); Focus(); }));
            tools.Controls.Add(Theme.Button("Load saved links", async delegate { for (int i = 0; i < model.Count; i++) if (!string.IsNullOrWhiteSpace(links[i].Text)) await LoadGame(i); }));
            tools.Controls.Add(Theme.Label("Boxes:", 10)); count.DropDownStyle = ComboBoxStyle.DropDownList; count.Width = 60; count.Items.AddRange(Enumerable.Range(1, 9).Select(i => (object)i).ToArray()); count.SelectedIndex = 6; tools.Controls.Add(count);
            layout.DropDownStyle = ComboBoxStyle.DropDownList; layout.Width = 250; layout.Items.AddRange(new object[] { "Main game + supporting games", "Equal grid" }); layout.SelectedIndex = 0; tools.Controls.Add(layout);
            tools.Controls.Add(follow); shell.Controls.Add(tools, 0, 1);
            var sound = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false };
            sound.Controls.Add(Theme.Label("ON THE MIC:", 9, Theme.Muted)); sound.Controls.Add(listening); sound.Controls.Add(Theme.Button("Mute all", delegate { model.Listen(-1); }));
            sound.Controls.Add(Theme.Label("Volume", 9, Theme.Muted)); var volume = new TrackBar { Minimum = 0, Maximum = 100, Value = 100, TickStyle = TickStyle.None, Width = 140, Height = 30 };
            volume.ValueChanged += async delegate { foreach (var player in players) await player.SetVolume(volume.Value / 100.0); }; sound.Controls.Add(volume); shell.Controls.Add(sound, 0, 2);
            var lineup = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoScroll = true, FlowDirection = FlowDirection.TopDown, WrapContents = false };
            shell.Controls.Add(lineup, 0, 3);
            for (int i = 0; i < 9; i++) {
                int id = i;
                var row = new Panel { Height = 76, Width = 1210, BackColor = Theme.Panel, Margin = new Padding(0, 0, 0, 7) }; rows[i] = row;
                var table = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 7, RowCount = 2, Padding = new Padding(4) };
                table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 37)); table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 145)); table.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
                foreach (int width in new int[] { 80, 83, 100, 69 }) table.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, width));
                table.RowStyles.Add(new RowStyle(SizeType.Absolute, 38)); table.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); row.Controls.Add(table);
                table.Controls.Add(Theme.Label((i + 1).ToString("00"), 12, Theme.Lime), 0, 0);
                names[i] = Theme.Input(); names[i].Text = "Game " + (i + 1); table.Controls.Add(names[i], 1, 0);
                links[i] = Theme.Input(); table.Controls.Add(links[i], 2, 0);
                var load = Theme.Button("Load link", async delegate { await LoadGame(id); }, true); load.Dock = DockStyle.Fill; table.Controls.Add(load, 3, 0);
                audioButtons[i] = Theme.Button("Listen", delegate { model.Listen(id); }); audioButtons[i].Dock = DockStyle.Fill; table.Controls.Add(audioButtons[i], 4, 0);
                mainButtons[i] = Theme.Button("Make main", delegate { Promote(id); }); mainButtons[i].Dock = DockStyle.Fill; table.Controls.Add(mainButtons[i], 5, 0);
                var clear = Theme.Button("Clear", delegate { players[id].Clear(); model.Cleared(id); }); clear.Dock = DockStyle.Fill; table.Controls.Add(clear, 6, 0);
                statuses[i] = Theme.Label("Paste the game’s page link", 8, Theme.Muted); statuses[i].Dock = DockStyle.Fill; table.Controls.Add(statuses[i], 1, 1); table.SetColumnSpan(statuses[i], 4);
                var reload = Theme.Button("Reload page", delegate { players[id].ReloadPage(); }); reload.Font = new Font("Segoe UI", 8); reload.Margin = new Padding(3, 0, 3, 0); reload.Dock = DockStyle.Fill; table.Controls.Add(reload, 5, 1); table.SetColumnSpan(reload, 2);
                names[i].TextChanged += delegate { players[id].GameName = names[id].Text.Trim(); model.Notify(); SaveSettings(); };
                links[i].Leave += delegate { SaveSettings(); };
                links[i].KeyDown += async delegate(object sender, KeyEventArgs e) { if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; await LoadGame(id); } };
                players[i].Changed += delegate { if (model.Audio == id && !players[id].Loaded) model.Cleared(id); else RefreshControls(); };
                lineup.Controls.Add(row);
            }
            lineup.Resize += delegate { foreach (var row in rows) row.Width = Math.Max(900, lineup.ClientSize.Width - SystemInformation.VerticalScrollBarWidth - 4); };
            var footer = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = true };
            footer.Controls.Add(feedback); footer.Controls.Add(Theme.Label("Sign in inside the visualizer. Logins are separate from Chrome. Provider playback compatibility is not yet verified.", 9, Theme.Muted));
            footer.Controls.Add(Theme.Button("Save lineup", SaveSettings)); footer.Controls.Add(Theme.Button("Clear all players", delegate { model.Listen(-1); foreach (var player in players) player.Clear(); RefreshControls(); })); shell.Controls.Add(footer, 0, 4);
            count.SelectedIndexChanged += delegate { if (refreshing) return; try { model.SetCount(count.SelectedIndex + 1); SaveSettings(); } catch (Exception error) { feedback.Text = error.Message; RefreshControls(); } };
            layout.SelectedIndexChanged += delegate { if (refreshing) return; model.EqualGrid = layout.SelectedIndex == 1; model.Notify(); SaveSettings(); };
            model.Changed += RefreshControls;
            RestoreSettings(); RefreshControls();
            Shown += delegate { visualizer.MoveTo(Screen.AllScreens[Math.Min(monitor.SelectedIndex, Screen.AllScreens.Length - 1)]); visualizer.Show(); Focus(); };
            FormClosing += delegate { closing = true; SaveSettings(); visualizer.ShuttingDown = true; visualizer.Close(); };
        }
        void ShowVisualizer() { if (!visualizer.Visible) visualizer.Show(); if (visualizer.WindowState == FormWindowState.Minimized) visualizer.WindowState = FormWindowState.Normal; visualizer.BringToFront(); }
        void PlayerFocused(int id) { if (follow.Checked && players[id].Loaded) { try { model.Listen(id); } catch (Exception error) { feedback.Text = error.Message; } } }
        void Promote(int id) { model.MakeMain(id); SaveSettings(); }
        async Task LoadGame(int id) {
            try {
                var uri = GameLinks.Parse(links[id].Text); links[id].Text = uri.AbsoluteUri;
                players[id].GameName = names[id].Text.Trim(); ShowVisualizer();
                bool first = !players.Any(p => p.Loaded);
                await players[id].LoadLink(uri.AbsoluteUri);
                if (first && players[id].Loaded && model.Audio < 0) model.Listen(id);
                SaveSettings(); RefreshControls();
            } catch (Exception error) { feedback.Text = error.Message; }
        }
        void RefreshControls() {
            if (closing || refreshing || model == null) return;
            refreshing = true;
            try {
                count.SelectedIndex = model.Count - 1; layout.SelectedIndex = model.EqualGrid ? 1 : 0;
                for (int i = 0; i < players.Length; i++) {
                    rows[i].Visible = i < model.Count; audioButtons[i].Enabled = players[i].Loaded;
                    audioButtons[i].Text = model.Audio == i ? "Listening" : "Listen";
                    mainButtons[i].Text = model.Main == i ? "★ Main" : "Make main";
                    mainButtons[i].ForeColor = model.Main == i ? Theme.Lime : Theme.Text;
                    statuses[i].Text = players[i].Status;
                }
                listening.Text = model.Audio < 0 ? "All games muted" : (string.IsNullOrWhiteSpace(names[model.Audio].Text) ? "Game " + (model.Audio + 1) : names[model.Audio].Text);
                visualizer.Arrange();
            } finally { refreshing = false; }
        }
        void SaveSettings() {
            if (model == null || refreshing || links.Any(link => link == null)) return;
            try {
                var saved = new SavedLineup { Count = model.Count, Main = model.Main, EqualGrid = model.EqualGrid, Names = names.Select(name => name.Text).ToArray(), Links = links.Select(link => link.Text).ToArray() };
                File.WriteAllText(settingsFile, new JavaScriptSerializer().Serialize(saved));
            } catch (Exception error) { if (!closing) feedback.Text = "Could not save lineup: " + error.Message; }
        }
        void RestoreSettings() {
            if (!File.Exists(settingsFile)) return;
            refreshing = true;
            try {
                var saved = new JavaScriptSerializer().Deserialize<SavedLineup>(File.ReadAllText(settingsFile));
                model.SetCount(Math.Max(1, Math.Min(9, saved.Count))); model.MakeMain(Math.Max(0, Math.Min(model.Count - 1, saved.Main))); model.EqualGrid = saved.EqualGrid;
                for (int i = 0; i < 9; i++) { names[i].Text = saved.Names != null && i < saved.Names.Length ? saved.Names[i] ?? "Game " + (i + 1) : "Game " + (i + 1); links[i].Text = saved.Links != null && i < saved.Links.Length ? saved.Links[i] ?? "" : ""; }
            } catch (Exception error) { feedback.Text = "Could not restore saved lineup: " + error.Message; }
            finally { refreshing = false; }
        }
    }
}
