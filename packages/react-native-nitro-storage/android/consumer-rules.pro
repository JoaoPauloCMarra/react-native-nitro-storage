# NitroStorage - JNI-callable methods must survive R8/ProGuard shrinking

-keep class com.nitrostorage.AndroidStorageAdapter {
    public static *** set*(...);
    public static *** get*(...);
    public static *** delete*(...);
    public static *** has*(...);
    public static *** clear*(...);
    public static *** size*(...);
    public static *** flush*(...);
    public static void init(android.content.Context);
    public static void setSecureWritesAsync(boolean);
    public static void setSecureAccessControl(int);
    public static void removeByPrefix(java.lang.String, int);
}
-keep class com.nitrostorage.AndroidStorageAdapter$Companion {
    public <methods>;
}
-keep class com.nitrostorage.NitroStoragePackage {
    <init>();
    <clinit>();
    *;
}
-keep class com.nitrostorage.NitroStoragePackage$Companion {
    *;
}
