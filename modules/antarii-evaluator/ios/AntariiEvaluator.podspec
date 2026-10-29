require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'AntariiEvaluator'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: 'https://antarii.com/not-published.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.source_files = '**/*.{h,m,swift}'

  # 🔴 THE RUST STATIC LIBRARY, AND WHY IT IS A `vendored_libraries`.
  #
  # CI cross-compiles the crate to `aarch64-apple-ios` and places the archive
  # here as `libantarii_evaluator.a` BEFORE `expo prebuild`. CocoaPods then
  # links it into the pod. Swift reaches its `extern "C"` functions through
  # `antarii_evaluator.h` below — no shim, because Swift calls C natively.
  #
  # ⚠ THE GLOB IS DELIBERATE. A missing archive makes this an empty list and
  # the pod still builds; the app runs and the probe reports `not-hosted` on
  # screen. *Naming the file directly would make a missing library a BUILD
  # failure, and a build that fails teaches less than a probe that reports.*
  s.vendored_libraries = Dir[File.join(__dir__, 'libantarii_evaluator.a')]
    .map { |p| File.basename(p) }

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
