import postcss from 'postcss'
import tw from '@tailwindcss/postcss'
import fs from 'node:fs'
const css = fs.readFileSync('src/app/globals.css', 'utf8')
const out = await postcss([tw()]).process(css, { from: 'src/app/globals.css', to: process.argv[2] })
fs.writeFileSync(process.argv[2], out.css)
console.log('css bytes', out.css.length)
