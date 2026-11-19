import fs from 'node:fs';
import Ajv from 'ajv';
import standaloneCode from 'ajv/dist/standalone/index.js';
const catalog=JSON.parse(fs.readFileSync(new URL('../src/catalog.json',import.meta.url)));
const ajv=new Ajv({code:{source:true,esm:true}});
const exports={};
for(const tool of catalog){ajv.addSchema({...tool.input_schema,additionalProperties:false},tool.name);exports[tool.name]=tool.name;}
fs.writeFileSync(new URL('../src/validators.js',import.meta.url),standaloneCode(ajv,exports));
