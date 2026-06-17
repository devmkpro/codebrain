"use strict";

/**
 * Background worker dispatch bridge handler.
 * Detects trigger patterns in text and dispatches background workers.
 * Detects trigger patterns in text and dispatches background workers.
 */

const TRIGGERS = [
  {
    name: "optimize",
    patterns: [/optimize/i, /improve\s+performance/i, /make\s+(it\s+)?faster/i, /speed\s+up/i],
    priority: "high",
    description: "Performance optimization task detected",
    capabilities: ["profiling", "optimization", "benchmarking"],
  },
  {
    name: "audit",
    patterns: [/security\s+audit/i, /vulnerability/i, /cve/i, /owasp/i, /check\s+security/i],
    priority: "critical",
    description: "Security audit task detected",
    capabilities: ["security", "vulnerability-scanning", "audit"],
  },
  {
    name: "document",
    patterns: [/document\s+(this|the)/i, /generate\s+docs/i, /write\s+docs/i, /add\s+comments/i],
    priority: "normal",
    description: "Documentation task detected",
    capabilities: ["documentation", "writing"],
  },
  {
    name: "refactor",
    patterns: [/refactor/i, /clean\s+up\s+code/i, /improve\s+readability/i, /code\s+quality/i],
    priority: "high",
    description: "Refactoring task detected",
    capabilities: ["refactoring", "code-quality"],
  },
  {
    name: "benchmark",
    patterns: [/benchmark/i, /performance\s+test/i, /load\s+test/i, /stress\s+test/i],
    priority: "normal",
    description: "Benchmarking task detected",
    capabilities: ["benchmarking", "profiling"],
  },
  {
    name: "testgaps",
    patterns: [/test\s+coverage/i, /missing\s+tests/i, /add\s+tests/i, /write\s+tests/i],
    priority: "high",
    description: "Test coverage gap detected",
    capabilities: ["testing", "coverage"],
  },
  {
    name: "deepdive",
    patterns: [/deep\s+dive/i, /analyze\s+thoroughly/i, /investigate/i, /root\s+cause/i],
    priority: "normal",
    description: "Deep analysis task detected",
    capabilities: ["analysis", "research"],
  },
];

function createWorkerDispatch(opts) {
  return {
    /**
     * Scan text for trigger patterns and return detected triggers.
     */
    async workerDetect({ text }) {
      if (!text) return { ok: false, error: "text is required" };

      const detected = [];
      for (const trigger of TRIGGERS) {
        for (const pattern of trigger.patterns) {
          if (pattern.test(text)) {
            detected.push({
              name: trigger.name,
              priority: trigger.priority,
              description: trigger.description,
              capabilities: trigger.capabilities,
              matchedPattern: pattern.source,
            });
            break; // Only match once per trigger
          }
        }
      }

      return {
        ok: true,
        detected,
        count: detected.length,
        hasHighPriority: detected.some((t) => t.priority === "critical" || t.priority === "high"),
      };
    },

    /**
     * List available trigger definitions.
     */
    async workerListTriggers() {
      return {
        ok: true,
        triggers: TRIGGERS.map((t) => ({
          name: t.name,
          priority: t.priority,
          description: t.description,
          capabilities: t.capabilities,
          patternCount: t.patterns.length,
        })),
      };
    },

    /**
     * Get provider health status.
     */
    async providerHealth() {
      const healthMap = opts.providerHealth;
      if (!healthMap) return { ok: true, providers: [] };

      const providers = [];
      for (const [id, health] of healthMap) {
        const total = health.successCount + health.errorCount;
        const errorRate = total > 0 ? health.errorCount / total : 0;
        let status = "healthy";
        if (errorRate > 0.5) status = "critical";
        else if (errorRate > 0.2) status = "degraded";

        providers.push({
          id,
          status,
          successCount: health.successCount,
          errorCount: health.errorCount,
          errorRate: Math.round(errorRate * 100),
          lastError: health.lastError,
          lastErrorAt: health.lastErrorAt,
          lastSuccessAt: health.lastSuccessAt,
        });
      }

      return { ok: true, providers };
    },
  };
}

module.exports = { createWorkerDispatch };
