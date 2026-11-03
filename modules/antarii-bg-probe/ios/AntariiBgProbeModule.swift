import BackgroundTasks
import ExpoModulesCore

/**
 Leg (i) on iOS — **which background task requests iOS is holding for us.**

 🔴 **WHY THIS EXISTS.** `expo-background-task` submits its request inside a
 detached `Task` (`BackgroundTaskScheduler.swift`, `didRegisterTask`), so a
 refusal from `BGTaskScheduler.submit` — *not permitted*, *unavailable* — is
 thrown into nothing. The panel's *"registered"* only says the JavaScript call
 returned. ✕ **It does not say iOS accepted the request**, and a request iOS
 never accepted looks exactly like one iOS chose not to run: no mark either way.

 ✅ **READ-ONLY, DELIBERATELY.** This asks `pendingTaskRequests()` and nothing
 else. ✕ It never submits or cancels: a probe that re-submitted would change the
 very request whose fate leg (i) is waiting on.
 */
public class AntariiBgProbeModule: Module {

  public func definition() -> ModuleDefinition {
    // Must match `requireOptionalNativeModule('AntariiBgProbeModule')` and the
    // `apple.modules` entry in `expo-module.config.json`.
    Name("AntariiBgProbeModule")

    AsyncFunction("pendingTaskRequests") { () async -> [[String: String]] in
      let requests = await BGTaskScheduler.shared.pendingTaskRequests()
      let iso = ISO8601DateFormatter()
      return requests.map { r in
        var entry: [String: String] = [
          "identifier": r.identifier,
          "earliestBeginDate": r.earliestBeginDate.map { iso.string(from: $0) } ?? "",
        ]
        if let p = r as? BGProcessingTaskRequest {
          entry["kind"] = "processing"
          entry["requiresNetworkConnectivity"] = String(p.requiresNetworkConnectivity)
          entry["requiresExternalPower"] = String(p.requiresExternalPower)
        } else if r is BGAppRefreshTaskRequest {
          entry["kind"] = "refresh"
        } else {
          entry["kind"] = "other"
        }
        return entry
      }
    }
  }
}
