// Command gen-icons renders the Tab Sender extension icons (16/48/128 PNG)
// using only the Go standard library. It draws a rounded square with a blue
// gradient and a white "send" arrow (up-right), supersampled 4x and box-filtered
// down for smooth edges.
package main

import (
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"path/filepath"
)

const ss = 4 // supersample factor

func main() {
	sizes := []int{16, 48, 128}
	// Output into the extension's icons directory, resolved relative to this
	// file's location: <repo>/tools/gen-icons -> <repo>/extension/icons.
	outDir := filepath.Join("..", "..", "extension", "icons")
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		panic(err)
	}
	for _, s := range sizes {
		img := render(s * ss)
		out := downsample(img, s)
		path := filepath.Join(outDir, "icon_"+itoa(s)+".png")
		f, err := os.Create(path)
		if err != nil {
			panic(err)
		}
		if err := png.Encode(f, out); err != nil {
			f.Close()
			panic(err)
		}
		f.Close()
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}
	return string(b)
}

// render draws the icon at resolution S*S (already supersampled).
func render(S int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, S, S))
	// Corners and radius for the rounded square.
	r := S * 24 / 100 // 24% corner radius
	pad := S * 6 / 100
	top := color.RGBA{10, 132, 255, 255}    // #0A84FF
	bottom := color.RGBA{0, 102, 222, 255} // #0066DE
	white := color.RGBA{255, 255, 255, 255}

	for y := 0; y < S; y++ {
		for x := 0; x < S; x++ {
			if !inRoundedRect(x, y, pad, pad, S-2*pad, S-2*pad, r) {
				img.Set(x, y, color.RGBA{0, 0, 0, 0})
				continue
			}
			// Vertical gradient.
			t := float64(y-pad) / float64(S-2*pad)
			c := lerpC(top, bottom, t)
			img.Set(x, y, c)
		}
	}

	// White "send" arrow (up-right), in normalized 0..1 coordinates.
	thick := float64(S) * 0.10
	// Tip at (0.70, 0.30); stem from lower-left to tip; head lines left & down.
	stem0 := vec{0.30, 0.70}
	stem1 := vec{0.70, 0.30}
	headL := vec{0.44, 0.30}
	headD := vec{0.70, 0.56}

	for y := 0; y < S; y++ {
		for x := 0; x < S; x++ {
			p := vec{float64(x) / float64(S), float64(y) / float64(S)}
			if distSeg(p, stem0, stem1) <= thick/2 ||
				distSeg(p, stem1, headL) <= thick/2 ||
				distSeg(p, stem1, headD) <= thick/2 {
				img.Set(x, y, white)
			}
		}
	}
	return img
}

type vec struct{ X, Y float64 }

func distSeg(p, a, b vec) float64 {
	ax, ay := a.X, a.Y
	bx, by := b.X, b.Y
	dx, dy := bx-ax, by-ay
	l2 := dx*dx + dy*dy
	if l2 == 0 {
		return math.Hypot(p.X-ax, p.Y-ay)
	}
	t := ((p.X-ax)*dx + (p.Y-ay)*dy) / l2
	if t < 0 {
		t = 0
	} else if t > 1 {
		t = 1
	}
	cx, cy := ax+t*dx, ay+t*dy
	return math.Hypot(p.X-cx, p.Y-cy)
}

func inRoundedRect(x, y, rx, ry, rw, rh, r int) bool {
	if x < rx || y < ry || x >= rx+rw || y >= ry+rh {
		return false
	}
	// Inside the central cross? then definitely inside.
	if x >= rx+r && x < rx+rw-r {
		return true
	}
	if y >= ry+r && y < ry+rh-r {
		return true
	}
	// Otherwise check the nearest corner.
	cx, cy := rx+r, ry+r
	if x >= rx+rw-r {
		cx = rx + rw - r
	}
	if y >= ry+rh-r {
		cy = ry + rh - r
	}
	dx := float64(x - cx)
	dy := float64(y - cy)
	return dx*dx+dy*dy <= float64(r*r)
}

func lerpC(a, b color.RGBA, t float64) color.RGBA {
	if t < 0 {
		t = 0
	} else if t > 1 {
		t = 1
	}
	return color.RGBA{
		R: uint8(float64(a.R) + (float64(b.R)-float64(a.R))*t),
		G: uint8(float64(a.G) + (float64(b.G)-float64(a.G))*t),
		B: uint8(float64(a.B) + (float64(b.B)-float64(a.B))*t),
		A: 255,
	}
}

// downsample box-filters an Ss*Ss image to S*S.
func downsample(src *image.RGBA, S int) *image.RGBA {
	dst := image.NewRGBA(image.Rect(0, 0, S, S))
	for y := 0; y < S; y++ {
		for x := 0; x < S; x++ {
			var r, g, b, a, n uint32
			for dy := 0; dy < ss; dy++ {
				for dx := 0; dx < ss; dx++ {
					sx, sy := x*ss+dx, y*ss+dy
					c := src.RGBAAt(sx, sy)
					r += uint32(c.R)
					g += uint32(c.G)
					b += uint32(c.B)
					a += uint32(c.A)
					n++
				}
			}
			dst.SetRGBA(x, y, color.RGBA{
				R: uint8(r / n), G: uint8(g / n), B: uint8(b / n), A: uint8(a / n),
			})
		}
	}
	return dst
}
