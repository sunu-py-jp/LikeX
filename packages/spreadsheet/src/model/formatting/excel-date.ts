/** Shared 1900 date system, including Excel's fictitious 1900-02-29 (serial 60). */
export const EXCEL_DAY_MILLISECONDS = 86_400_000;
export const EXCEL_DATE_EPOCH = Date.UTC(1899, 11, 31);
export const EXCEL_DATE_SERIAL_END = 2958466;
export function excelSerialFromUtc(milliseconds: number): number {
  return (milliseconds - EXCEL_DATE_EPOCH) / EXCEL_DAY_MILLISECONDS + (milliseconds >= Date.UTC(1900, 2, 1) ? 1 : 0);
}
export function excelUtcFromSerial(serial: number): number {
  return EXCEL_DATE_EPOCH + (serial >= 60 ? serial - 1 : serial) * EXCEL_DAY_MILLISECONDS;
}
