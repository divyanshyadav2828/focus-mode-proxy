using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;

namespace NetworkWebFilterProxy
{
    class Program
    {
        private static Process nodeProcess = null;

        [DllImport("Kernel32")]
        private static extern bool SetConsoleCtrlHandler(EventHandler handler, bool add);
        private delegate bool EventHandler(CtrlType sig);
        private static EventHandler handler;

        private enum CtrlType
        {
            CTRL_C_EVENT = 0,
            CTRL_BREAK_EVENT = 1,
            CTRL_CLOSE_EVENT = 2,
            CTRL_LOGOFF_EVENT = 5,
            CTRL_SHUTDOWN_EVENT = 6
        }

        private static bool Handler(CtrlType sig)
        {
            KillNode();
            return false;
        }

        private static void KillNode()
        {
            try
            {
                if (nodeProcess != null && !nodeProcess.HasExited)
                {
                    nodeProcess.Kill();
                }
            }
            catch { }
        }

        static void Main(string[] args)
        {
            try
            {
                Console.Title = "Network Web Filter Proxy - Divyansh Yadav";
            }
            catch { }

            handler = new EventHandler(Handler);
            SetConsoleCtrlHandler(handler, true);
            AppDomain.CurrentDomain.ProcessExit += (s, e) => KillNode();

            string appData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string targetDir = Path.Combine(appData, "NetworkWebFilterProxy");
            string exePath = Assembly.GetExecutingAssembly().Location;
            string exeTimestamp = File.GetLastWriteTimeUtc(exePath).Ticks.ToString();
            string markerFile = Path.Combine(targetDir, ".version_" + exeTimestamp);

            if (!Directory.Exists(targetDir) || !File.Exists(markerFile))
            {
                Console.ForegroundColor = ConsoleColor.Cyan;
                Console.WriteLine("[*] Initializing Network Web Filter Proxy environment...");
                Console.ResetColor();

                try
                {
                    if (Directory.Exists(targetDir))
                    {
                        Directory.Delete(targetDir, true);
                    }
                    Directory.CreateDirectory(targetDir);

                    Assembly asm = Assembly.GetExecutingAssembly();
                    using (Stream resStream = asm.GetManifestResourceStream("Payload.zip"))
                    {
                        if (resStream == null)
                        {
                            Console.ForegroundColor = ConsoleColor.Red;
                            Console.WriteLine("[!] Error: Embedded resource Payload.zip not found.");
                            Console.ResetColor();
                            Console.WriteLine("Press any key to exit...");
                            Console.ReadKey();
                            return;
                        }

                        string zipPath = Path.Combine(targetDir, "payload.zip");
                        using (FileStream fs = new FileStream(zipPath, FileMode.Create, FileAccess.Write))
                        {
                            resStream.CopyTo(fs);
                        }

                        ZipFile.ExtractToDirectory(zipPath, targetDir);
                        File.Delete(zipPath);
                        File.WriteAllText(markerFile, DateTime.UtcNow.ToString());
                    }
                }
                catch (Exception ex)
                {
                    Console.ForegroundColor = ConsoleColor.Red;
                    Console.WriteLine("[!] Extraction error: " + ex.Message);
                    Console.ResetColor();
                }
            }

            // Auto-install / trust root certificate if present
            string certPath = Path.Combine(targetDir, "certs", "ca.crt");
            if (File.Exists(certPath))
            {
                try
                {
                    ProcessStartInfo certPsi = new ProcessStartInfo("certutil.exe", "-user -addstore -f ROOT \"" + certPath + "\"");
                    certPsi.CreateNoWindow = true;
                    certPsi.UseShellExecute = false;
                    Process certProc = Process.Start(certPsi);
                    certProc.WaitForExit(3000);
                }
                catch { }
            }

            string nodePath = Path.Combine(targetDir, "node.exe");
            string scriptPath = Path.Combine(targetDir, "proxy.js");

            if (!File.Exists(nodePath))
            {
                // Fallback to system node if not bundled
                nodePath = "node.exe";
            }

            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = nodePath;
            psi.Arguments = "\"" + scriptPath + "\"";
            psi.WorkingDirectory = targetDir;
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = false;
            psi.RedirectStandardError = false;

            try
            {
                nodeProcess = Process.Start(psi);
                nodeProcess.WaitForExit();
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine("[!] Proxy launch error: " + ex.Message);
                Console.ResetColor();
                Console.WriteLine("Press any key to exit...");
                Console.ReadKey();
            }
        }
    }
}
