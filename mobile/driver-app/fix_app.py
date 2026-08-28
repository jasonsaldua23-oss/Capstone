import re

with open('App.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

imports = """import { useFonts, Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, Poppins_700Bold, Poppins_800ExtraBold, Poppins_900Black } from "@expo-google-fonts/poppins";
"""
content = re.sub(r'(import React.*?;)', r'\1\n' + imports, content)

fonts_hook = """  const [fontsLoaded] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
    Poppins_700Bold,
    Poppins_800ExtraBold,
    Poppins_900Black,
  });

  if (!fontsLoaded) return null;
"""
content = re.sub(r'(export default function App\(\) \{\n)', r'\1' + fonts_hook, content)

font_map = {
    '"400"': '"Poppins_400Regular"',
    '"500"': '"Poppins_500Medium"',
    '"600"': '"Poppins_600SemiBold"',
    '"700"': '"Poppins_700Bold"',
    '"800"': '"Poppins_800ExtraBold"',
    '"900"': '"Poppins_900Black"',
    '"bold"': '"Poppins_700Bold"',
    '"normal"': '"Poppins_400Regular"',
}
def replace_font_weight(match):
    weight = match.group(1)
    if weight in font_map:
        return f'fontFamily: {font_map[weight]}'
    return match.group(0)

content = re.sub(r'fontWeight:\s*("(?:400|500|600|700|800|900|bold|normal)")', replace_font_weight, content)

content = content.replace('fontSize: 15 },', 'fontSize: 15, fontFamily: "Poppins_400Regular" },')
content = content.replace('fontSize: 14 },', 'fontSize: 14, fontFamily: "Poppins_400Regular" },')
content = content.replace('fontSize: 13 },', 'fontSize: 13, fontFamily: "Poppins_400Regular" },')
content = content.replace('fontSize: 12 },', 'fontSize: 12, fontFamily: "Poppins_400Regular" },')

content = content.replace('backgroundColor: "#edf5fb"', 'backgroundColor: "#dff0ea"') 
content = content.replace('backgroundColor: "#eaf1f2"', 'backgroundColor: "#eaf1f2"') 
content = content.replace('borderColor: "#cbd5e1"', 'borderColor: "#f59e0b"') # Set cancel buttons to orange border like screenshot

with open('App.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
print("Patched App.tsx!")
