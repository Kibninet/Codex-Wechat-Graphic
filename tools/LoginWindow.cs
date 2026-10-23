using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class LoginProgram {
    [STAThread] static int Main(string[] args) {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        try {
            if (args.Length > 0 && args[0] == "--self-test") { LoginWindow.SelfTest(args[1]); return 0; }
            if (args.Length > 0 && args[0] == "--preview") {
                using (var form = new LoginWindow(true)) {
                    form.Show(); Application.DoEvents();
                    using (var bitmap = new Bitmap(form.Width, form.Height)) { form.DrawToBitmap(bitmap, new Rectangle(0, 0, form.Width, form.Height)); bitmap.Save(args[1]); }
                }
                return 0;
            }
            bool created;
            using (var mutex = new Mutex(true, "Local\\Codex-Wechat.LoginWindow", out created)) {
                if (!created) { MessageBox.Show("配置窗口已经打开，请在任务栏中找到它。", "Codex-Wechat"); return 0; }
                Application.Run(new LoginWindow(false));
            }
            return 0;
        } catch (Exception error) {
            if(args.Length > 1 && args[0] == "--self-test") { File.WriteAllText(args[1], new JavaScriptSerializer().Serialize(new { passed=false, error=error.Message })); return 1; }
            MessageBox.Show("配置窗口无法启动。请完整解压发行包，或使用 1-Setup.cmd。", "Codex-Wechat"); return 1;
        }
    }
}

internal sealed class LoginWindow : Form {
    readonly string root = AppDomain.CurrentDomain.BaseDirectory;
    readonly string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Codex-Wechat");
    readonly bool preview;
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    readonly List<Button> operations = new List<Button>();
    TextBox workspace, deviceCode;
    CheckBox permissions;
    Label codexState, wechatState, serviceState, automaticState, message, qrHint;
    Button cancel, openAuth, copyCode;
    PictureBox qr;
    Process operation;
    bool busy, refreshing, closing, cancelled, dirty;
    string currentAction = "", authorizationUrl = "", lastQr = "";
    DateTime loginStarted, nextRefresh = DateTime.MinValue;
    static readonly Color Ink = Color.FromArgb(30, 41, 59), Muted = Color.FromArgb(100, 116, 139), Accent = Color.FromArgb(13, 148, 136);

    public LoginWindow(bool isPreview, string testData = null) {
        preview = isPreview;
        if(testData != null) data = testData;
        Text = "Codex-Wechat · 登录与配置";
        Font = new Font("Microsoft YaHei UI", 9F);
        BackColor = Color.FromArgb(244, 247, 250); ForeColor = Ink;
        ClientSize = new Size(900, 684); FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false; StartPosition = FormStartPosition.CenterScreen; AutoScaleMode = AutoScaleMode.Dpi;
        var header = new Panel { Bounds = new Rectangle(0, 0, 900, 96), BackColor = Ink };
        Controls.Add(header);
        AddLabel(header, "Codex-Wechat", 28, 18, 580, 34, 21, Color.White);
        AddLabel(header, "电脑负责计算，微信接收结果。三步完成连接。", 30, 59, 710, 24, 10, Color.FromArgb(203, 213, 225));
        var left = Card(24, 116, 518, 470);
        var right = Card(560, 116, 316, 470);
        AddLabel(left, "01   设置工作目录", 20, 17, 470, 28, 13, Ink);
        workspace = new TextBox { Bounds = new Rectangle(20, 56, 382, 29) };
        workspace.TextChanged += delegate { dirty = true; };
        left.Controls.Add(workspace);
        MakeButton(left, "浏览…", 410, 54, 88, delegate {
            using (var dialog = new FolderBrowserDialog { Description = "选择供手机聊天使用的项目目录", SelectedPath = workspace.Text }) {
                if (dialog.ShowDialog(this) == DialogResult.OK) workspace.Text = dialog.SelectedPath;
            }
        });
        AddLabel(left, "权限", 20, 98, 42, 26, 9, Muted);
        permissions = new CheckBox { Bounds = new Rectangle(65, 96, 280, 28), Text = "完全访问（允许修改文件）", Checked = false };
        permissions.CheckedChanged += delegate { dirty = true; }; left.Controls.Add(permissions);
        MakeButton(left, "保存设置", 366, 94, 132, delegate { SaveSettings(); });
        AddLabel(left, "后台运行时请先停止，再修改设置。", 20, 134, 470, 23, 9, Muted);
        AddLabel(left, "02   登录账号", 20, 177, 470, 28, 13, Ink);
        codexState = AddLabel(left, "Codex：正在读取状态", 20, 220, 300, 28, 10, Ink);
        MakeButton(left, "登录 Codex", 366, 216, 132, delegate { BeginLogin("LoginCodexGui"); });
        wechatState = AddLabel(left, "微信：正在读取状态", 20, 264, 300, 28, 10, Ink);
        MakeButton(left, "微信扫码登录", 366, 260, 132, delegate { BeginLogin("LoginWeChatGui"); });
        AddLabel(left, "已保存登录时，通常可以直接启动，无需重复扫码。", 20, 306, 478, 42, 9, Muted);
        AddLabel(left, "03   启动连接", 20, 353, 470, 28, 13, Ink);
        MakeButton(left, "启动后台", 20, 399, 150, delegate { RunAction("Start", null); }, true);
        MakeButton(left, "停止后台", 184, 399, 150, delegate { RunAction("Stop", null); });
        MakeButton(left, "刷新状态", 348, 399, 150, delegate { RefreshState(); });
        AddLabel(right, "登录面板", 18, 17, 278, 28, 13, Ink);
        qr = new PictureBox { Bounds = new Rectangle(44, 64, 228, 228), BackColor = Color.FromArgb(246, 248, 250), SizeMode = PictureBoxSizeMode.Zoom };
        right.Controls.Add(qr);
        qrHint = AddLabel(right, "点击“微信扫码登录”\n二维码将显示在这里", 26, 300, 264, 43, 10, Muted); qrHint.TextAlign = ContentAlignment.MiddleCenter;
        deviceCode = new TextBox { Bounds = new Rectangle(22, 354, 272, 30), ReadOnly = true, TextAlign = HorizontalAlignment.Center, Font = new Font("Consolas", 13), Text = "等待 Codex 授权码" };
        right.Controls.Add(deviceCode);
        openAuth = MakeButton(right, "打开官方授权页", 22, 399, 164, delegate { OpenAuthorization(); }, false, false);
        copyCode = MakeButton(right, "复制代码", 196, 399, 98, delegate { if (copyCode.Enabled) Clipboard.SetText(deviceCode.Text); }, false, false);
        openAuth.Enabled = copyCode.Enabled = false;
        serviceState = AddLabel(this, "后台：正在检查", 30, 600, 235, 24, 10, Ink);
        automaticState = AddLabel(this, "自动启动：正在检查", 280, 600, 315, 24, 10, Muted);
        MakeButton(this, "打开数据目录", 731, 596, 145, delegate { Directory.CreateDirectory(data); Process.Start(new ProcessStartInfo("explorer.exe", Quote(data)) { UseShellExecute = true }); });
        message = AddLabel(this, "正在读取本地配置…", 30, 635, 700, 42, 9, Muted);
        cancel = MakeButton(this, "取消登录", 757, 638, 119, delegate { CancelOperation(); }, false, false); cancel.Visible = false;
        timer.Interval = 500;
        timer.Tick += delegate {
            if (busy && currentAction == "LoginWeChatGui") UpdateQr();
            if (!busy && DateTime.UtcNow >= nextRefresh) RefreshState();
        };
        Shown += delegate {
            if (preview) {
                workspace.Text = @"D:\Projects\Workspace"; dirty = false;
                codexState.Text = "Codex：尚未保存登录"; wechatState.Text = "微信：尚未保存登录";
                serviceState.Text = "● 后台未启动"; automaticState.Text = "自动启动：未启用";
                message.Text = "先保存工作目录，再依次登录并启动。关闭此窗口不会停止后台。";
            } else { timer.Start(); RefreshState(); }
        };
        FormClosing += delegate { closing = true; cancelled = true; timer.Stop(); var active = operation; if(active != null) KillTree(active); if (qr.Image != null) qr.Image.Dispose(); };
    }
    Panel Card(int x, int y, int w, int h) { var panel = new Panel { Bounds = new Rectangle(x,y,w,h), BackColor = Color.White }; Controls.Add(panel); return panel; }
    static Label AddLabel(Control parent, string text, int x, int y, int w, int h, float size, Color color) {
        var label = new Label { Text = text, Bounds = new Rectangle(x,y,w,h), ForeColor = color, Font = new Font("Microsoft YaHei UI", size), AutoEllipsis = true };
        parent.Controls.Add(label); return label;
    }
    Button MakeButton(Control parent, string text, int x, int y, int width, Action click, bool primary = false, bool managed = true) {
        var button = new Button { Text = text, Bounds = new Rectangle(x,y,width,34), FlatStyle = FlatStyle.Flat, BackColor = primary ? Accent : Color.White, ForeColor = primary ? Color.White : Ink, Cursor = Cursors.Hand, UseVisualStyleBackColor = false };
        button.FlatAppearance.BorderColor = primary ? Accent : Color.FromArgb(215, 223, 232);
        button.Click += delegate { if (!preview) click(); }; parent.Controls.Add(button); if(managed) operations.Add(button); return button;
    }
    static internal string Quote(string value) { return "\"" + Regex.Replace(Regex.Replace(value, "(\\\\*)\"", "$1$1\\\""), "(\\\\+)$", "$1$1") + "\""; }
    static internal string Clean(string text) { return Regex.Replace(text ?? "", "\x1B\\[[0-?]*[ -/]*[@-~]", ""); }
    static internal string ExtractUrl(string text) {
        var match = Regex.Match(Clean(text), @"https://auth\.openai\.com/[A-Za-z0-9/_?=&#%.+-]+", RegexOptions.IgnoreCase);
        return match.Success ? match.Value : "";
    }
    static internal string ExtractCode(string text) {
        var match = Regex.Match(Clean(text), @"(?m)^\s*([A-Z0-9]{4,5}-[A-Z0-9]{4,5})\s*$");
        return match.Success ? match.Groups[1].Value : "";
    }
    void OnUI(Action action) { if (!closing && !IsDisposed && IsHandleCreated) { try { BeginInvoke(action); } catch (InvalidOperationException) {} } }
    ProcessStartInfo Backend(string action, string extra) {
        var script = Path.Combine(root, "tools", "Manage.ps1");
        if (!File.Exists(script)) throw new FileNotFoundException();
        var info = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), @"WindowsPowerShell\v1.0\powershell.exe"), "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " + Quote(script) + " -Action " + action + " -DataDir " + Quote(data) + (extra ?? ""));
        info.WorkingDirectory = Path.Combine(root, "app"); info.UseShellExecute = false; info.CreateNoWindow = true;
        info.RedirectStandardInput = true; info.RedirectStandardOutput = true; info.RedirectStandardError = true;
        info.StandardOutputEncoding = Encoding.UTF8; info.StandardErrorEncoding = Encoding.UTF8;
        info.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
        return info;
    }
    void SaveSettings() {
        string path = workspace.Text.Trim();
        if (path.Length == 0 || !Path.IsPathRooted(path) || path.IndexOfAny(new char[] {'"','\r','\n'}) >= 0) { message.Text = "请选择有效的绝对工作目录。"; return; }
        RunAction("SaveConfig", " -WorkspacePath " + Quote(path) + " -PermissionsMode " + (permissions.Checked ? "full-access" : "default-permissions"));
    }
    void BeginLogin(string action) {
        lastQr = ""; authorizationUrl = ""; deviceCode.Text = "等待 Codex 授权码";
        openAuth.Enabled = copyCode.Enabled = false;
        if (qr.Image != null) { qr.Image.Dispose(); qr.Image = null; }
        qrHint.Text = action == "LoginWeChatGui" ? "正在生成二维码，请稍候…" : "在官方网页完成 Codex 授权\n随后返回此窗口";
        loginStarted = DateTime.UtcNow; RunAction(action, null);
    }
    void SetBusy(bool value) { busy = value; foreach (var button in operations) button.Enabled = !value; workspace.Enabled = permissions.Enabled = !value; cancel.Visible = value && currentAction.StartsWith("Login"); }
    void RunAction(string action, string extra) {
        if (busy || refreshing) { message.Text = "正在更新状态，请稍候再试。"; return; }
        currentAction = action; cancelled = false; SetBusy(true);
        message.Text = action.StartsWith("Login") ? "正在登录；重新登录会暂停后台，完成后请点击“启动后台”。" : "正在处理，请稍候…";
        Task.Run(delegate {
            int exitCode = -1;
            try {
                using (var process = new Process { StartInfo = Backend(action, extra) }) {
                    var output = new StringBuilder(); object gate = new object();
                    DataReceivedEventHandler receive = delegate(object sender, DataReceivedEventArgs ev) {
                        if (ev.Data == null || action != "LoginCodexGui") return;
                        string snapshot; lock(gate) { if(output.Length < 32768) output.AppendLine(ev.Data); snapshot = output.ToString(); }
                        string url = ExtractUrl(snapshot), code = ExtractCode(snapshot);
                        OnUI(delegate { if (!busy || cancelled) return; if(url.Length > 0) { authorizationUrl = url; openAuth.Enabled = true; } if(code.Length > 0) { deviceCode.Text = code; copyCode.Enabled = true; } });
                    };
                    process.OutputDataReceived += receive; process.ErrorDataReceived += receive;
                    process.Start(); operation = process;
                    process.StandardInput.Close(); process.BeginOutputReadLine(); process.BeginErrorReadLine();
                    if (cancelled || closing) KillTree(process);
                    process.WaitForExit(); exitCode = process.ExitCode; operation = null;
                }
            } catch (Exception) { operation = null; }
            OnUI(delegate {
                SetBusy(false); currentAction = "";
                if (action.StartsWith("Login")) { openAuth.Enabled = copyCode.Enabled = false; deviceCode.Text = "授权结束"; authorizationUrl = ""; if(qr.Image != null) { qr.Image.Dispose(); qr.Image = null; } qrHint.Text = "登录结束；如需连接，请启动后台。"; }
                if (cancelled) message.Text = "登录已取消。原有登录文件保留；需要时可再次登录或启动后台。";
                else if(exitCode == 0) { if(action == "SaveConfig") dirty = false; message.Text = action.StartsWith("Login") ? "登录完成并已保存在本机。点击“启动后台”即可连接。" : action == "Start" ? "后台已启动。微信发送 /status 检查连接；关闭此窗口后后台仍继续运行。" : action == "Stop" ? "后台已停止，自动恢复已停用。" : "配置已保存。接下来登录账号并启动后台。"; }
                else message.Text = action == "SaveConfig" ? "保存失败：请先停止后台，并检查目录是否可写。" : "操作未完成。请检查网络或运行 Doctor.cmd；登录超时可重新尝试。";
                RefreshState();
            });
        });
    }
    static void KillTree(Process process) {
        try { if (process.HasExited) return; using (var killer = Process.Start(new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "taskkill.exe"), "/PID " + process.Id + " /T /F") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true })) { killer.StandardOutput.ReadToEnd(); killer.StandardError.ReadToEnd(); killer.WaitForExit(); } } catch (InvalidOperationException) {} catch (System.ComponentModel.Win32Exception) {}
    }
    void CancelOperation() { if (!busy) return; cancelled = true; var process = operation; if(process != null) Task.Run(delegate { KillTree(process); }); }
    void OpenAuthorization() {
        Uri uri;
        if (Uri.TryCreate(authorizationUrl, UriKind.Absolute, out uri) && uri.Scheme == "https" && uri.Host.Equals("auth.openai.com", StringComparison.OrdinalIgnoreCase)) {
            try { Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true }); } catch(Exception) { message.Text = "浏览器无法打开，请检查默认浏览器设置。"; }
        }
    }
    void UpdateQr() {
        try {
            string folder = Path.Combine(data, @"weixin\login"); if (!Directory.Exists(folder)) return;
            var file = new DirectoryInfo(folder).GetFiles().Where(f => Regex.IsMatch(f.Extension, @"^\.(png|jpg|jpeg|gif)$", RegexOptions.IgnoreCase) && f.LastWriteTimeUtc >= loginStarted.AddSeconds(-1)).OrderByDescending(f => f.LastWriteTimeUtc).FirstOrDefault();
            if (file == null) return;
            string identity = file.FullName + file.LastWriteTimeUtc.Ticks;
            if (identity == lastQr) return;
            using (var stream = new FileStream(file.FullName, FileMode.Open, FileAccess.Read, FileShare.ReadWrite)) using (var original = Image.FromStream(stream)) {
                var image = new Bitmap(original); if (qr.Image != null) qr.Image.Dispose(); qr.Image = image;
            }
            lastQr = identity; qrHint.Text = "请用微信扫描二维码\n并在手机上确认登录";
        } catch(IOException) {} catch(ArgumentException) {} catch(OutOfMemoryException) {}
    }
    void RefreshState() {
        if (busy || refreshing || preview || closing) return;
        refreshing = true; nextRefresh = DateTime.UtcNow.AddSeconds(10);
        Task.Run(delegate {
            Dictionary<string, object> state = null;
            try {
                using (var process = Process.Start(Backend("StatusJson", null))) {
                    var readOut = process.StandardOutput.ReadToEndAsync(); var readErr = process.StandardError.ReadToEndAsync();
                    process.StandardInput.Close();
                    if (!process.WaitForExit(12000)) { KillTree(process); } else {
                        Task.WaitAll(readOut, readErr);
                        if(process.ExitCode == 0) state = json.Deserialize<Dictionary<string, object>>(readOut.Result.Trim());
                    }
                }
            } catch(Exception) {}
            OnUI(delegate {
                refreshing = false;
                if(state == null) { serviceState.Text = "状态读取失败"; message.Text = "请确认完整解压发行包，或运行 Doctor.cmd 进行诊断。"; return; }
                codexState.Text = "Codex：" + ((bool)state["codexLoginSaved"] ? "已保存登录" : "尚未保存登录");
                wechatState.Text = "微信：" + ((bool)state["wechatLoginSaved"] ? "已保存登录" : "尚未保存登录");
                serviceState.Text = (bool)state["running"] ? "● 后台正在运行" : "● 后台未启动";
                serviceState.ForeColor = (bool)state["running"] ? Accent : Muted;
                automaticState.Text = "Windows 登录自动启动：" + ((bool)state["automaticStartup"] ? "已启用" : "未启用");
                if(!dirty) {
                    workspace.Text = (string)state["workspace"];
                    if(workspace.Text.Length == 0) workspace.Text = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "CodexWechatWorkspace");
                    permissions.Checked = (string)state["permissionsMode"] == "full-access"; dirty = false;
                }
                if(message.Text == "正在读取本地配置…") message.Text = "先保存工作目录，再依次登录并启动。已登录时可以直接启动。";
            });
        });
    }
    internal static void SelfTest(string output) {
        Action<bool, string> check = delegate(bool ok, string name) { if (!ok) throw new Exception(name); };
        check(ExtractUrl("Visit https://auth.openai.com/codex/device\n") == "https://auth.openai.com/codex/device", "official URL");
        check(ExtractUrl("https://auth.openai.com.evil.example/device") == "", "host boundary");
        check(ExtractUrl("https://evil.example/device") == "", "foreign URL");
        check(ExtractCode("\u001b[32m  ABCD-EFGH \u001b[0m\n") == "ABCD-EFGH", "ANSI code");
        check(ExtractCode("  ABCDE-FGHIJ\n") == "ABCDE-FGHIJ", "long code");
        check(ExtractCode("account: secret-12345") == "", "private output");
        check(Quote(@"C:\Project files\") == "\"C:\\Project files\\\\\"", "trailing slash");
        string fixture = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(output)), "gui-test-fixtures");
        Directory.CreateDirectory(Path.Combine(fixture, @"weixin\login"));
        using(var form = new LoginWindow(true, fixture)) {
            form.Show(); Application.DoEvents();
            check(form.permissions.Checked == false, "permission default");
            check(form.openAuth.Enabled == false && form.copyCode.Enabled == false, "empty auth disabled");
            string image = Path.Combine(fixture, @"weixin\login\test.png");
            using(var bitmap = new Bitmap(64,64)) { using(var g = Graphics.FromImage(bitmap)) { g.Clear(Color.White); g.FillRectangle(Brushes.Black, 8, 8, 24, 24); } bitmap.Save(image); }
            File.SetLastWriteTimeUtc(image, DateTime.UtcNow.AddMinutes(-5));
            form.loginStarted = DateTime.UtcNow; form.UpdateQr(); check(form.qr.Image == null, "old QR rejected");
            File.SetLastWriteTimeUtc(image, DateTime.UtcNow); form.UpdateQr(); check(form.qr.Image != null, "fresh QR embedded");
            using(var stream = new FileStream(image, FileMode.Open, FileAccess.ReadWrite, FileShare.None)) { check(stream.Length > 0, "QR file unlocked"); }
            form.Close();
        }
        string node = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, @"runtime\node\node.exe");
        string script = Path.Combine(fixture, "cancel-fixture.cjs"), childPid = Path.Combine(fixture, "child.pid");
        File.WriteAllText(script, "const fs=require('fs');if(process.argv[2]==='child'){setInterval(()=>{},1000)}else{const c=require('child_process').spawn(process.execPath,[__filename,'child'],{stdio:'ignore',windowsHide:true});fs.writeFileSync(process.argv[2],String(c.pid));setInterval(()=>{},1000)}");
        using(var parent = Process.Start(new ProcessStartInfo(node, Quote(script) + " " + Quote(childPid)) { UseShellExecute=false, CreateNoWindow=true })) {
            try {
                for(int i=0;i<50 && (!File.Exists(childPid) || File.GetLastWriteTimeUtc(childPid) < parent.StartTime.ToUniversalTime().AddSeconds(-1));i++) Thread.Sleep(100);
                using(var child = Process.GetProcessById(Int32.Parse(File.ReadAllText(childPid)))) {
                    KillTree(parent); check(parent.WaitForExit(5000), "cancel parent"); check(child.WaitForExit(5000), "cancel descendant");
                }
            } finally { KillTree(parent); }
        }
        File.WriteAllText(output, "{\"passed\":true,\"checks\":14,\"networkUsed\":false,\"loginStarted\":false,\"processTreeCancelled\":true,\"freshQrEmbedded\":true}", new UTF8Encoding(false));
    }
}
