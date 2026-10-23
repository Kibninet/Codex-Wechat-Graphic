using System;
using System.Diagnostics;
using System.Text;

// A GUI-subsystem process: Task Scheduler never creates an interactive console.
internal static class WeixinBridgeHost
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length < 2) return 2;
        var arguments = new StringBuilder();
        for (int index = 1; index < args.Length; index++)
        {
            if (index > 1) arguments.Append(' ');
            arguments.Append(QuoteArgument(args[index]));
        }
        try
        {
            var options = new ProcessStartInfo
            {
                FileName = args[0],
                Arguments = arguments.ToString(),
                UseShellExecute = false,
                CreateNoWindow = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };
            using (var process = new Process { StartInfo = options })
            {
                // The supervisor already persists its own logs. Drain its pipes so
                // a long-lived process cannot block on a full output buffer.
                process.OutputDataReceived += delegate { };
                process.ErrorDataReceived += delegate { };
                if (!process.Start()) return 3;
                process.StandardInput.Close();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                process.WaitForExit();
                return process.ExitCode;
            }
        }
        catch { return 4; }
    }

    private static string QuoteArgument(string value)
    {
        // Windows CommandLineToArgvW quoting, including trailing backslashes.
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            if (character == '"')
            {
                result.Append('\\', slashes * 2 + 1);
                result.Append('"');
            }
            else
            {
                result.Append('\\', slashes);
                result.Append(character);
            }
            slashes = 0;
        }
        result.Append('\\', slashes * 2);
        result.Append('"');
        return result.ToString();
    }
}
