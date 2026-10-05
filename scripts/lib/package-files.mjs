import { libraryModule } from './modules.mjs';

/** Explicit distribution allowlist shared by packing and independent consumer checks. */
export function allowedPackageFile(file, module) {
  if (file.includes('\\') || file.split('/').some(part => !part || part === '.' || part === '..')) return false;
  if (/^(package\.json|README\.md|src\/README\.md|src\/(LICENSE|THIRD_PARTY_NOTICES\.md)|src\/docs\/[^/]+\.md|THIRD_PARTY_NOTICES\.md|LICENSE|NOTICE|dist\/.+)$/.test(file)) return true;
  const skillName = libraryModule(module).skillName;
  if (!skillName || !file.startsWith(`skills/${skillName}/`)) return false;
  const relative = file.slice(`skills/${skillName}/`.length);
  if (module === 'slide' && /^(references\/(image-export|design-guide|layout-examples)\.md|scripts\/render-images\.mjs)$/.test(relative)) return true;
  if (['spreadsheet', 'slide'].includes(module) && relative === 'references/inspect.md') return true;
  if (module === 'document' && relative === 'references/image-analysis.md') return true;
  return /^(SKILL\.md|references\/(schema-guide\.md|commands\.md|commands\.schema\.json|spon\.schema\.json|slon\.schema\.json|dcon\.schema\.json|board\.schema\.json|dataview\.schema\.json|diagram\.schema\.json|whiteboard\.schema\.json|calendar\.schema\.json|aichat\.schema\.json|chat\.schema\.json|form\.schema\.json)|scripts\/document\.mjs)$/.test(relative);
}
