require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))
ios_deployment_target = defined?(min_ios_version_supported) ? min_ios_version_supported : "15.1"

Pod::Spec.new do |s|
  s.name         = "react-native-nitro-storage"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => ios_deployment_target }
  s.source       = { :git => "https://github.com/JoaoPauloCMarra/react-native-nitro-storage.git", :tag => "v#{s.version}" }
  s.module_name  = "NitroStorage"

  s.source_files = [
    "ios/**/*.{h,m,mm,swift}",
    "cpp/**/*.{h,hpp,c,cpp}"
  ]
  s.exclude_files = [
    "cpp/**/*Test.cpp",
    "cpp/build/**",
    "ios/**/*Test.mm"
  ]

  s.pod_target_xcconfig = {
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
    "CLANG_CXX_LIBRARY" => "libc++",
    "DEFINES_MODULE" => "YES",
    "HEADER_SEARCH_PATHS" => [
      "\"$(PODS_TARGET_SRCROOT)/cpp/core\"",
      "\"$(PODS_TARGET_SRCROOT)/cpp/bindings\"",
      "\"$(PODS_TARGET_SRCROOT)/nitrogen/generated/shared/c++\"",
      "\"$(PODS_TARGET_SRCROOT)/nitrogen/generated/ios\""
    ].join(" ")
  }

  s.libraries = "sqlite3"

  s.dependency "React-Core"
  
  load 'nitrogen/generated/ios/NitroStorage+autolinking.rb'
  add_nitrogen_files(s)
  install_modules_dependencies(s)
end
