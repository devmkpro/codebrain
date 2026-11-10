/** Keep a detached launcher console from crashing the desktop process. */
interface OutputStream {
  on(event: "error", listener: (error: NodeJS.ErrnoException) => void): unknown;
  removeListener(event: "error", listener: (error: NodeJS.ErrnoException) => void): unknown;
}

interface ConsoleTransport {
  level: string | false;
  writeFn: (...args: any[]) => void;
}

export function guardConsoleOutput(
  transport: ConsoleTransport,
  streams: OutputStream[] = [process.stdout, process.stderr],
): () => void {
  const write = transport.writeFn;
  const isBrokenPipe = (error: unknown): boolean =>
    !!error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "EPIPE";
  const onError = (error: NodeJS.ErrnoException) => {
    if (!isBrokenPipe(error)) throw error;
    // File transport stays enabled. Never log back into the broken console.
    transport.level = false;
  };
  transport.writeFn = function (...args) {
    try { write.apply(this, args); }
    catch (error) {
      if (!isBrokenPipe(error)) throw error;
      transport.level = false;
    }
  };
  streams.forEach((stream) => stream.on("error", onError));
  return () => {
    streams.forEach((stream) => stream.removeListener("error", onError));
    transport.writeFn = write;
  };
}
