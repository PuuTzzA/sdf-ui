use      transition: background-color 1s, --depth 1s;
change some mapWithMaterial back to map (cache speedup and such)

The origin of the canvas is top left and goes to 1, height/width if fullscreen. The z-Coordinate increases towards the viwer, with the camera at position SdfCanvas.cameraZ looking in (0, 0, -1) direction with a orthographic camera.

## Compile Time Constants
There are a few variables that can only be set at the very beginning **before** calling `initWebgl`. These are:

* **useAA:** enables Anti-Aliasing. This program uses Multisample Anti-Aliasing with four samples. 
  > [!Note]
  > Enabling Anti-Aliasing massively decreases performance because all calculations need to be performed four times. Additionally compile time increases when enabling it. Therefore it is suggested to only turn on Anti-Aliasing when using the 2d-mode, because there performance and compile time are massively reduced by default. 
* **twoDMode:** Enables a 2d mode, where instead of tracing a ray through the scene, the sdf is only evaluated once at a z-Depth of 0. 
* **useCustomShadeFunction:** Enables the use of a custom `shade` function to control the exact look of the scene. Otherwise the scene is shaded as described below in the Shading section. If a custom shading function is used it has to be stored as a string in the `customShadeFunction` member of the sdfCanvas object. This custom shade function takes the traced position as an input and returns the color that should be rendered at that point. It has to be of the following format:
  
```glsl
vec3 shade(Surface surface); // if twoDMode is used
vec3 shade(HitInfo hit); // if the normal 3d mode is used

// the Structs are defined as follows:
struct Surface {
    vec3 colorDiffuse;
    float kd; // diffuse material property
    vec3 colorSpecular;
    float ks; // specular material property
    vec3 colorAmbient;
    float ka; // ambient material property
    float p; // specular exponent (specular fall off)
    float mix; // mix factor
    float distance; // distance the the nearest surface
};

struct HitInfo {
    vec3 pos; // position of the surface point
    int id; // amount of steps of sphere-tracing; or -1 if it missed
    vec3 normal; // normal of the surface point
    Surface surface; // blended surface at the surface point
};
```

## Shading

All sdf elements support the following extra css properties: 

* **--diffuse-color:** controls the `diffuseColor` ($C_d$) of the object.
* **--specular-color:** controls the `specularColor` ($C_s$) of the object.
* **--ambient-color:** controls the `ambientColor` ($C_a$) of the object.
* **--kd:** controls the diffuse parameter ($k_d$) of the object.
* **--ks:** controls the specular parameter ($k_s$) of the object.
* **--p:** controls the specular exponent ($p$) of the object.
* **--ka:** controls the ambient parameter ($k_a$) of the object.

The final color ($C$) of a point on the surface with normal $\vec{n}$, vector towards the light source $\vec{l}$ view vector towards the camera $\vec{v}$ is then calculated with the standart **Phong shading model:**

$I_d = k_d \cdot \texttt{max}(\vec{n} \cdot \vec{l}, 0)\\
I_s = k_s \cdot \texttt{max}(\texttt{reflect}(\vec{l}, \vec{n}) \cdot \vec{v}, 0)^{p}\\
C = I_d \cdot C_d + I_s \cdot C_s + k_a \cdot C_a$

Where $\texttt{reflect}$ calculates the perfect reflection direction of $\vec{l}$ when reflected along $\vec{n}$.

## Supported Elements

The position of each element is computed from its position on the page. The elements have additional properties to control their specific attributes

The z-position (the more positive the higher on the page, like z-index, but as a float) is controlled by the css property **--z**. The z-value controlls the z-value of the center of the object. 

All objects can be rotated, translated or skewed (in 2D or 3D) with the css `transform` property (e.g. `rotate`, `rotate3d`, `translate`, ...)

The supported primitive objects are:

> [!Important]
> For all elements with border roundings, keep in mind that in order for the element to be rendered correctly the width/height/depth has to be large enough. E.g. if you have `border-radius: 5rem;` with `width: 7rem;` then the element is not rendered correctly because it is not wide enough.

### 1. Sphere: 
A normal sphere.
```html
<sdf-sphere id="test-sdf-sphere" data-layer-index="1">Sphere</sdf-sphere>
```
* **--r:** controls the radius of the sphere.

### 2. Simple Box
A simple box with width, height and depth.
```html
<sdf-box-simple id="test-sdf-box-simple" data-layer-index="1">Simple Box</sdf-box-simple>
```
* **width, heigth:** Width and height are controled with the standard css properties widht and height
* **--depth:** Controls the depth of the box. 

### 3. Box
A more general box that also supports border-radius.
```html
<sdf-box id="test-sdf-box" data-layer-index="1">Box with rounded corners</sdf-box>
```
* **width, heigth, depth:** Controled in the same way as for the simple box (css properties width, height, --depth).
* **border-radius:** Controls the border radius (same as normal css). May be different for each corner.
* **--border-radius-type:** Controls the type of the radius. See [this article](https://iquilezles.org/articles/roundedboxes/) for more details. It should be an integer in {0, 1, 2, 3}. These are the options:
  * **1: Circle:** Default, normal circle (css uses this).
  * **2: Parabola:** Parabolic corner (smoother than circle).
  * **3: Cosine:** Both of the previvous solution have discontinuities in the second derivative of the normal, leading to a hard cut in the lighting. Cosing similarity fixes this by fitting a cosine to the curve. But this is **more computationally expensive** because there is no closed form solution and the result is found with binary search.
  * **4: Cubic:** Also provides continuous second derivatives (smooth lighting), also requires **binary search** to find the result.
* **--rotation-offset:** Controlls the intitial rotation of the box, i.e. axis around wich the corners are rounded. Can be {0, 1, 2}. 
  * **0:** Default, corners that are parallel to the z-axis are rounded.
  * **1:** Corners parallel to the x-axis are rounded.
  * **2:** Corners parallel to the y-axis are rounded.

### 4. Rounded Box
A box where all edges are rounded.
```html
<sdf-box-round id="test-sdf-box-round" data-layer-index="1">Rounded Box</sdf-box-round>
```
* **width, heigth, depth:** Controled in the same way as for the simple box (css properties width, height, --depth).
* **--r:** Controls the border radius that is applied to all edges.

### 5. Text
A element that contains text that which is rendered as sdf elements. As of now there is one supported font **metaballs** (only lower case letters and numbers for now). All the letters inside one sdf-text elment will have the same material and size. Sdf-text elements support `letter-spacing`, `word-spacing` and `word-break`.

```html
<sdf-text id="test-sdf-box-round" data-layer-index="1">Text</sdf-text>
```

* **--depth:** Controls the depth of the letters.
* **--letterSmoothness:** Controls the smoothing between individual letters, wich are internally combined using a `SMOOTH_UNION` function. A value of 0 means no smoothing at all.

## Layers

The elements are placed in layers that control how the elements are blended to already existing elements in the scene. The layer an element is on can be controlled with the `data-layer-index` property of the html element. E.g.:

```html
<sdf-box-simple id="test-sdf-box-simple" data-layer-index="1">Simple Box</sdf-box-simple>
```

The layer is an index. First all elements in the lowest layer are added to the scene, then the ones from the next layer, ...

The elements are always blended with the defined `LayerOperation`:

```js
static LayerOperation = Object.freeze({
    UNION: 0,
    SUBTRACTION: 1,
    INTERSECTION: 2,
    XOR: 3,
    SMOOTH_UNION: 4,
    SMOOTH_SUBTRACTION: 5,
    SMOOTH_INTERSECTION: 6,
})
```

The smooth operations also have a corresponding `smoothingFactor` per layer to control the amount of smoothing.


## Render Layers

To constrain certain elements to certain canvasses, you can define a `data-reder-layers` per element like so:

```html
<sdf-sphere class="test-sdf-sphere" data-render-layers="0" data-layer-index="1">Sphere</sdf-sphere>
```

An element can have multiple canvas-indices signaled by a space ` ` between the two.   

```html
<sdf-sphere class="test-sdf-sphere" data-render-layers="0 1" data-layer-index="1">Sphere</sdf-sphere>
```

The SdfCanvases in js also have a renderLayers property. While rendering they now only render elements that share a common render layer. E.g. if an element has the render layers [0, 4, 5] and a canvas renderes the layers [1, 2, 3] then that canvas will not render the element. But if the canvas rendered the layers [0, 2, 3] instead the element would be rendered. 