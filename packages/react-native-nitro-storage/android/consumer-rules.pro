# Keep AndroidStorageAdapter and all its methods - accessed via JNI reflection
-keep class com.nitrostorage.AndroidStorageAdapter { *; }
-keepclassmembers class com.nitrostorage.AndroidStorageAdapter { *; }
-keepclassmembers class com.nitrostorage.AndroidStorageAdapter$Companion { *; }
