"""Derive a zero-slide POTX fixture from the independent python-pptx compatibility fixture."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import re
root=Path(__file__).parent
with ZipFile(root/'powerpoint-basic.pptx') as source:
    parts={name:source.read(name) for name in source.namelist()}
def replace(name,fn):parts[name]=fn(parts[name].decode()).encode()
replace('[Content_Types].xml',lambda s:s.replace('presentationml.presentation.main+xml','presentationml.template.main+xml'))
replace('ppt/presentation.xml',lambda s:re.sub(r'<p:sldIdLst>.*?</p:sldIdLst>','<p:sldIdLst/>',s))
shape='<p:sp><p:nvSpPr><p:cNvPr id="900" name="Brand stripe"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="152400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="173F5F"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>'
replace('ppt/slideMasters/slideMaster1.xml',lambda s:s.replace('</p:spTree>',shape+'</p:spTree>'))
with ZipFile(root/'powerpoint-masters.potx','w',ZIP_DEFLATED) as out:
    for name,data in parts.items():out.writestr(name,data)
