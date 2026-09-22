export { openOfficePackage, openOfficePackageMetadata } from "./ooxml/zip-reader";
export type { OfficePackageArchive } from "./ooxml/zip-reader";
export { OFFICE_PACKAGE_LIMITS, OFFICE_PACKAGE_METADATA_LIMITS } from "./ooxml/types";
export type { OfficePackageInput, OfficePackageMetadataInput, OfficePackageSignal, OfficePackageBlob } from "./ooxml/types";
export * as officeXml from "./ooxml/xml";
export type { XmlNode as OfficeXmlNode } from "./ooxml/xml";
export { readRelationships as readOfficeRelationships, resolvePart as resolveOfficePart } from "./ooxml/relationships";
export type { OfficeRelationship } from "./ooxml/relationships";
