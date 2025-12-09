import * as fs from 'fs';
import * as path from 'path';

/**
 * Logger utility that writes to both console and file
 */
class Logger {
  private logDir: string;
  private currentLogFile: string | null = null;
  private currentDate: string = '';
  private originalConsoleLog: (...args: any[]) => void;
  private originalConsoleError: (...args: any[]) => void;
  private originalConsoleWarn: (...args: any[]) => void;

  constructor() {
    // Store original console methods before any overrides
    this.originalConsoleLog = console.log.bind(console);
    this.originalConsoleError = console.error.bind(console);
    this.originalConsoleWarn = console.warn.bind(console);

    // Ensure proper encoding for stdout/stderr (important for SSH terminals)
    if (process.stdout.setDefaultEncoding) {
      try {
        process.stdout.setDefaultEncoding('utf8');
      } catch (e) {
        // Ignore if not available
      }
    }
    if (process.stderr.setDefaultEncoding) {
      try {
        process.stderr.setDefaultEncoding('utf8');
      } catch (e) {
        // Ignore if not available
      }
    }

    // Create logs directory in project root
    this.logDir = path.join(process.cwd(), 'logs');
    
    // Ensure logs directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    // Initialize current date and log file
    this.updateLogFile();
  }

  /**
   * Update log file path based on current date
   */
  private updateLogFile(): void {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    
    if (this.currentDate !== today) {
      this.currentDate = today;
      this.currentLogFile = path.join(this.logDir, `app-${today}.log`);
    }
  }

  /**
   * Get module name from call stack
   */
  private getModuleName(): string {
    try {
      const stack = new Error().stack;
      if (!stack) return 'UNKNOWN';
      
      const stackLines = stack.split('\n');
      // Skip the first 3 lines (Error, getModuleName, write)
      // Look for the first file that's not logger.ts
      for (let i = 3; i < stackLines.length; i++) {
        const line = stackLines[i];
        if (!line) continue;
        
        // Extract file path from stack line
        // Format: "    at functionName (file:line:col)" or "    at file:line:col"
        const match = line.match(/\(([^)]+)\)|at\s+([^\s]+)/);
        if (match) {
          const filePath = match[1] || match[2];
          if (!filePath || filePath.includes('logger.ts') || filePath.includes('node_modules')) continue;
          
          // Extract module name from path
          // e.g., "D:\Upwork\solscan\src\tracker\tracker.ts" -> "tracker"
          // e.g., "D:\Upwork\solscan\src\services\poolMonitoringService.ts" -> "poolMonitoringService"
          const pathParts = filePath.split(/[/\\]/);
          const fileName = pathParts[pathParts.length - 1];
          const moduleName = fileName.replace(/\.(ts|js)$/, '');
          
          // Find src or dist directory index
          const srcIndex = pathParts.findIndex(part => part === 'src' || part === 'dist');
          if (srcIndex >= 0 && srcIndex < pathParts.length - 1) {
            // Get path after src/dist
            const afterSrc = pathParts.slice(srcIndex + 1);
            if (afterSrc.length > 1) {
              // If in subdirectory, use last two parts: "services/poolMonitoringService"
              const parentDir = afterSrc[afterSrc.length - 2];
              if (parentDir && parentDir !== 'src' && parentDir !== 'dist') {
                return `${parentDir}/${moduleName}`;
              }
            }
          }
          
          return moduleName;
        }
      }
    } catch (error) {
      // If stack parsing fails, return unknown
    }
    return 'UNKNOWN';
  }

  /**
   * Format timestamp for console (shorter format)
   */
  private formatTimestamp(): string {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${ms}`;
  }

  /**
   * Format log message with timestamp for file
   */
  private formatMessage(level: string, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    
    return `[${timestamp}] ${message}\n`;
  }

  /**
   * Sanitize string for SSH terminal compatibility
   * Removes emojis, non-printable characters, and handles binary data
   */
  public sanitizeForTerminal(str: string): string {
    // Replace common emojis with plain text alternatives
    const emojiMap: { [key: string]: string } = {
      '✅': '[OK]',
      '❌': '[ERROR]',
      '⚠️': '[WARN]',
      '🔴': '[RED]',
      '🟢': '[GREEN]',
      '🟡': '[YELLOW]',
      '🔵': '[BLUE]',
      '📥': '[RECV]',
      '📊': '[STATS]',
      '🧪': '[TEST]',
      '💡': '[TIP]',
      '⏳': '[WAIT]',
      '1️⃣': '[1]',
      '2️⃣': '[2]',
      '3️⃣': '[3]',
      '4️⃣': '[4]',
      '5️⃣': '[5]',
      '6️⃣': '[6]',
      '7️⃣': '[7]',
      '8️⃣': '[8]',
      '9️⃣': '[9]',
    };

    let sanitized = str;
    
    // Replace emojis
    for (const [emoji, replacement] of Object.entries(emojiMap)) {
      sanitized = sanitized.replace(new RegExp(emoji, 'g'), replacement);
    }

    // Remove other emojis and non-printable characters (except common whitespace)
    // Keep ASCII printable characters (32-126) and common whitespace (tab, newline, carriage return)
    sanitized = sanitized.replace(/[\u{1F300}-\u{1F9FF}]/gu, ''); // Emoji range
    sanitized = sanitized.replace(/[\u{2600}-\u{26FF}]/gu, ''); // Miscellaneous symbols
    sanitized = sanitized.replace(/[\u{2700}-\u{27BF}]/gu, ''); // Dingbats
    
    // Remove non-printable characters except common whitespace (tab=0x09, newline=0x0A, carriage return=0x0D)
    // Keep printable ASCII (0x20-0x7E) and common whitespace
    sanitized = sanitized.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, '');
    
    // Handle any remaining binary data or invalid UTF-8 sequences
    // Convert to safe ASCII representation
    try {
      // Try to decode as UTF-8, replacing invalid sequences
      sanitized = Buffer.from(sanitized, 'utf8').toString('utf8');
      
      // Replace any remaining non-ASCII characters that might cause issues
      // Keep only ASCII printable characters and common whitespace
      sanitized = sanitized.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, (char) => {
        // For non-ASCII characters, try to represent them safely
        const code = char.charCodeAt(0);
        if (code <= 0xFF) {
          return `\\x${code.toString(16).padStart(2, '0')}`;
        }
        return `\\u${code.toString(16).padStart(4, '0')}`;
      });
    } catch (e) {
      // If UTF-8 conversion fails, replace all non-ASCII with placeholder
      sanitized = sanitized.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '?');
    }

    return sanitized;
  }

  /**
   * Format console message with timestamp and module
   */
  private formatConsoleMessage(module: string, ...args: any[]): string {
    const timestamp = this.formatTimestamp();
    const message = args.map(arg => {
      if (typeof arg === 'object') {
        try {
          return JSON.stringify(arg, null, 2);
        } catch (e) {
          return String(arg);
        }
      }
      return String(arg);
    }).join(' ');
    
    const formatted = `[${timestamp}] ${message}`;
    
    // Sanitize for terminal compatibility
    return this.sanitizeForTerminal(formatted);
  }

  /**
   * Write to both console and file
   */
  private write(level: string, consoleMethod: (...args: any[]) => void, ...args: any[]): void {
    // Update log file if date changed
    this.updateLogFile();
    
    // Get module name from call stack
    const moduleName = this.getModuleName();
    
    // Write to console with formatted message (with error handling for broken pipes)
    try {
      const formattedMessage = this.formatConsoleMessage(moduleName, ...args);
      // Use original console method directly to avoid recursion, but with sanitized message
      consoleMethod(formattedMessage);
    } catch (error: any) {
      // Handle EPIPE and other stream errors gracefully
      // These typically occur when stdout/stderr is closed or redirected
      // We'll silently ignore them to prevent crashes
      if (error.code === 'EPIPE' || error.code === 'EAGAIN') {
        // Broken pipe or resource temporarily unavailable - ignore
        // This often happens during shutdown or when output is redirected
      } else {
        // For other errors, try to log them (but don't crash)
        try {
          const errorMsg = this.sanitizeForTerminal(`Console write error (non-fatal): ${error.message || error}`);
          this.originalConsoleError(errorMsg);
        } catch {
          // If even error logging fails, silently ignore
        }
      }
    }
    
    // Write to file (preserve original data, no sanitization)
    if (this.currentLogFile) {
      try {
        const logMessage = this.formatMessage(level, ...args);
        fs.appendFileSync(this.currentLogFile, logMessage, 'utf8');
      } catch (error: any) {
        // Fallback: if file write fails, try to log to console (but don't crash)
        try {
          const errorMsg = this.sanitizeForTerminal(`Failed to write to log file: ${error.message || error}`);
          this.originalConsoleError(errorMsg);
        } catch {
          // If even error logging fails, silently ignore
        }
      }
    }
  }

  /**
   * Log info message
   */
  log(...args: any[]): void {
    this.write('INFO', this.originalConsoleLog, ...args);
  }

  /**
   * Log error message
   */
  error(...args: any[]): void {
    this.write('ERROR', this.originalConsoleError, ...args);
  }

  /**
   * Log warning message
   */
  warn(...args: any[]): void {
    this.write('WARN', this.originalConsoleWarn, ...args);
  }

  /**
   * Log debug message (only to file, not console)
   */
  debug(...args: any[]): void {
    this.updateLogFile();
    
    if (this.currentLogFile) {
      try {
        const logMessage = this.formatMessage('DEBUG', ...args);
        fs.appendFileSync(this.currentLogFile, logMessage, 'utf8');
      } catch (error) {
        // Silent fail for debug logs
      }
    }
  }
}

// Create singleton instance
const logger = new Logger();

/**
 * Sanitize buffer data for terminal output
 */
function sanitizeBuffer(buffer: Buffer): string {
  let str = buffer.toString('utf8');
  
  // Remove non-printable characters except common whitespace
  str = str.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, '');
  
  // Replace emojis and non-ASCII characters
  str = str.replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');
  
  // Replace any remaining non-ASCII with safe representation
  str = str.replace(/[^\x09\x0A\x0D\x20-\x7E]/g, (char) => {
    const code = char.charCodeAt(0);
    if (code <= 0xFF) {
      return `\\x${code.toString(16).padStart(2, '0')}`;
    }
    return `\\u${code.toString(16).padStart(4, '0')}`;
  });
  
  return str;
}

/**
 * Override console methods to also write to file
 */
export function setupFileLogging(): void {
  // Store original console methods
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;

  // Intercept stdout writes to sanitize output
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = function(chunk: any, encoding?: any, cb?: any): boolean {
    if (Buffer.isBuffer(chunk)) {
      const sanitized = sanitizeBuffer(chunk);
      return originalStdoutWrite(sanitized, encoding, cb);
    } else if (typeof chunk === 'string') {
      const sanitized = logger.sanitizeForTerminal(chunk);
      return originalStdoutWrite(sanitized, encoding, cb);
    }
    return originalStdoutWrite(chunk, encoding, cb);
  };

  // Intercept stderr writes to sanitize output
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = function(chunk: any, encoding?: any, cb?: any): boolean {
    if (Buffer.isBuffer(chunk)) {
      const sanitized = sanitizeBuffer(chunk);
      return originalStderrWrite(sanitized, encoding, cb);
    } else if (typeof chunk === 'string') {
      const sanitized = logger.sanitizeForTerminal(chunk);
      return originalStderrWrite(sanitized, encoding, cb);
    }
    return originalStderrWrite(chunk, encoding, cb);
  };

  // Override console.log
  console.log = (...args: any[]) => {
    logger.log(...args);
  };

  // Override console.error
  console.error = (...args: any[]) => {
    logger.error(...args);
  };

  // Override console.warn
  console.warn = (...args: any[]) => {
    logger.warn(...args);
  };

  // Keep console.info, console.debug as is (or override if needed)
  // console.info = console.log; // Already same as log
}

/**
 * Export logger instance for direct use if needed
 */
export { logger };
export default logger;

