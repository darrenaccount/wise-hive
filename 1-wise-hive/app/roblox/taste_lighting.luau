--!nocheck
-- Hivemind Taste: lighting helpers for Roblox Studio. A Working round runs this file with the Studio MCP's execute_luau
-- (the file's text followed by a call, e.g. print(snapshot())). Copied by the Hivemind app to
-- <brain>\roblox\scripts\taste_lighting.luau on every start.
--   snapshot()     -> JSON: Lighting's properties and its effect children (Atmosphere, Sky, Bloom, Blur, ColorCorrection,
--                     SunRays, DepthOfField). Save it BEFORE changing anything; it is the "before"/"after" in lighting.json.
--   camera()       -> JSON array of 12 numbers: the Studio camera's CFrame now (save one per fixed view).
--   camera(view)   -> moves the Studio camera to a saved view (12 numbers, or that JSON), so every version is shot alike.
--   restore(json)  -> puts a snapshot back (effect children the snapshot doesn't have are removed). Test places only.
-- Colours are [r, g, b] (0-1), enums "Enum.Technology.Future". Checked with Lune 0.10.5 (2026-10-13), not yet in Studio.
local HttpService = game:GetService("HttpService")
local Lighting = game:GetService("Lighting")

local PROPS = { "Technology", "Brightness", "ClockTime", "GeographicLatitude", "Ambient", "OutdoorAmbient", "ColorShift_Top", "ColorShift_Bottom",
	"EnvironmentDiffuseScale", "EnvironmentSpecularScale", "ShadowSoftness", "GlobalShadows", "ExposureCompensation", "FogColor", "FogStart", "FogEnd" }
local CHILD = {
	Atmosphere = { "Density", "Offset", "Color", "Decay", "Glare", "Haze" },
	Sky = { "SkyboxBk", "SkyboxDn", "SkyboxFt", "SkyboxLf", "SkyboxRt", "SkyboxUp", "SunAngularSize", "MoonAngularSize", "StarCount", "CelestialBodiesShown", "SunTextureId", "MoonTextureId" },
	BloomEffect = { "Enabled", "Intensity", "Size", "Threshold" },
	BlurEffect = { "Enabled", "Size" },
	ColorCorrectionEffect = { "Enabled", "Brightness", "Contrast", "Saturation", "TintColor" },
	SunRaysEffect = { "Enabled", "Intensity", "Spread" },
	DepthOfFieldEffect = { "Enabled", "FarIntensity", "FocusDistance", "InFocusRadius", "NearIntensity" },
}

local function enc(v)
	local t = typeof(v)
	if t == "Color3" then
		return { math.floor(v.R * 1000 + 0.5) / 1000, math.floor(v.G * 1000 + 0.5) / 1000, math.floor(v.B * 1000 + 0.5) / 1000 }
	elseif t == "EnumItem" then
		return tostring(v)
	elseif t == "number" then
		return math.floor(v * 10000 + 0.5) / 10000 -- floats come back as 0.44999998807907104
	elseif t == "boolean" or t == "string" then
		return v
	end
	return nil
end

local function dec(v)
	if type(v) == "table" and #v == 3 then
		return Color3.new(v[1], v[2], v[3])
	end
	if type(v) == "string" then
		local e, item = string.match(v, "^Enum%.(%w+)%.(%w+)$")
		if e then
			return (Enum :: any)[e][item]
		end
	end
	return v
end

local function props(o, list)
	local out = {}
	for _, k in ipairs(list) do
		local ok, v = pcall(function()
			return o[k]
		end)
		if ok then
			local e = enc(v)
			if e ~= nil then
				out[k] = e
			end
		end
	end
	return out
end

function snapshot()
	local children = {}
	for _, c in ipairs(Lighting:GetChildren()) do
		local list = CHILD[c.ClassName]
		if list then
			table.insert(children, { class = c.ClassName, name = c.Name, props = props(c, list) })
		end
	end
	return HttpService:JSONEncode({ lighting = props(Lighting, PROPS), children = children })
end

function camera(view)
	local cam = workspace.CurrentCamera
	if view ~= nil then
		if type(view) == "string" then
			view = HttpService:JSONDecode(view)
		end
		cam.CFrame = CFrame.new(table.unpack(view))
		return "moved"
	end
	return HttpService:JSONEncode({ cam.CFrame:GetComponents() })
end

function restore(json)
	local s = if type(json) == "string" then HttpService:JSONDecode(json) else json
	for k, v in pairs(s.lighting or {}) do
		pcall(function()
			Lighting[k] = dec(v)
		end)
	end
	local keep = {}
	for _, c in ipairs(s.children or {}) do
		keep[c.name] = true
		local o = Lighting:FindFirstChild(c.name)
		if not o then
			o = Instance.new(c.class)
			o.Name = c.name
			o.Parent = Lighting
		end
		for k, v in pairs(c.props or {}) do
			pcall(function()
				o[k] = dec(v)
			end)
		end
	end
	for _, o in ipairs(Lighting:GetChildren()) do
		if CHILD[o.ClassName] and not keep[o.Name] then
			o:Destroy()
		end
	end
	return "restored"
end
