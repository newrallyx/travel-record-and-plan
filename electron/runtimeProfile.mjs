export const STABLE_DESKTOP_PORT = 41873
export const PHOTO_ALBUM_PREVIEW_PORT = 41874
export const PHOTO_ALBUM_PREVIEW_USER_DATA_DIRECTORY = 'roadtrip-retrospective-tool-photo-album-preview'
export const P0_FIXES_TEST_PORT = 41875
export const P0_FIXES_TEST_USER_DATA_DIRECTORY = 'roadtrip-retrospective-tool-p0-fixes-test'

export function isPhotoAlbumPreviewRuntime(appName) {
  return appName === 'roadtrip-retrospective-photo-album-preview'
    || appName.includes('相册实验版')
}

export function isP0FixesTestRuntime(appName) {
  return appName === 'roadtrip-retrospective-p0-fixes-test'
    || appName.includes('P0修复测试版')
    || appName.includes('P0 修复测试版')
}

export function resolveDesktopRuntimeProfile(appName) {
  const isPhotoAlbumPreview = isPhotoAlbumPreviewRuntime(appName)
  const isP0FixesTest = isP0FixesTestRuntime(appName)
  const usesPhotoAlbumDataProfile = isPhotoAlbumPreview || appName === 'roadtrip-retrospective-photo-album'
  return {
    isPhotoAlbumPreview,
    isP0FixesTest,
    usesPhotoAlbumDataProfile,
    defaultPort: isP0FixesTest
      ? P0_FIXES_TEST_PORT
      : usesPhotoAlbumDataProfile
        ? PHOTO_ALBUM_PREVIEW_PORT
        : STABLE_DESKTOP_PORT,
    userDataDirectoryName: isP0FixesTest
      ? P0_FIXES_TEST_USER_DATA_DIRECTORY
      : usesPhotoAlbumDataProfile
        ? PHOTO_ALBUM_PREVIEW_USER_DATA_DIRECTORY
        : null,
    windowTitle: isP0FixesTest
      ? '旅行轨迹记录与规划工具 - P0 修复测试版'
      : isPhotoAlbumPreview
        ? '旅行轨迹记录与规划工具 - 相册实验版'
        : '旅行轨迹记录与规划工具',
  }
}

export function resolveDesktopPort(rawPort, defaultPort) {
  const port = Number.parseInt(rawPort ?? '', 10)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : defaultPort
}

export function isAllowedExternalUrl(rawUrl) {
  try {
    const protocol = new URL(rawUrl).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
