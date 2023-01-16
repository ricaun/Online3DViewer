import { IsObjectEmpty } from '../core/core.js';
import { Coord3D } from '../geometry/coord3d.js';
import { Direction } from '../geometry/geometry.js';
import { ArrayBufferToUtf8String } from '../io/bufferutils.js';
import { Node, NodeType } from '../model/node.js';
import { Mesh } from '../model/mesh.js';
import { Triangle } from '../model/triangle.js';
import { ImporterBase } from './importerbase.js';
import { Quaternion } from '../geometry/quaternion.js';
import { Matrix } from '../geometry/matrix.js';
import { Transformation } from '../geometry/transformation.js';
import { ColorToMaterialConverter, ColorToVertexColorsConverter } from './importerutils.js';
import { Property, PropertyGroup, PropertyType } from '../model/property.js';
import { RGBAColor } from '../main.js';

export class ImporterBim extends ImporterBase
{
    constructor ()
    {
        super ();
    }

    CanImportExtension (extension)
    {
        return extension === 'bim';
    }

    GetUpDirection ()
    {
        return Direction.Z;
    }

    ClearContent ()
    {
        this.meshIdToMesh = null;
        this.colorToMaterial = null;
    }

    ResetContent ()
    {
        this.meshIdToMesh = new Map ();
        this.colorToMaterial = new ColorToMaterialConverter (this.model);
    }

    ImportContent (fileContent, onFinish)
    {
        let textContent = ArrayBufferToUtf8String (fileContent);
        let bimJson = null;
        try {
            bimJson = JSON.parse (textContent);
        } catch (err) {
            this.SetError ('Failed to parse bim file.');
            onFinish ();
            return;
        }

        for (let bimMesh of bimJson.meshes) {
            this.meshIdToMesh.set (bimMesh.mesh_id, bimMesh);
        }

        this.ImportProperties (bimJson, this.model);
        for (let bimElement of bimJson.elements) {
            let mesh = this.ImportElement (bimElement);
            mesh.SetName (bimElement.type);
            this.ImportProperties (bimElement, mesh);
        }

        onFinish ();
    }

    ImportElement (bimElement)
    {
        let defaultMaterialIndex = null;
        if (bimElement.color)
        {
            defaultMaterialIndex = this.colorToMaterial.GetMaterialIndex (
                bimElement.color.r,
                bimElement.color.g,
                bimElement.color.b,
                bimElement.color.a
            );
        }

        let rootNode = this.model.GetRootNode ();

        let bimMesh = this.meshIdToMesh.get (bimElement.mesh_id);
        let mesh = null;

        // 1.0.0 - extension face_colors
        if (bimElement.face_colors)
        {
            mesh = this.ImportMeshMaterial (bimMesh, (triangleIndex) => {
                if (bimElement.face_colors) {
                    let faceMaterialIndex = this.colorToMaterial.GetMaterialIndex (
                        bimElement.face_colors[triangleIndex * 4 + 0],
                        bimElement.face_colors[triangleIndex * 4 + 1],
                        bimElement.face_colors[triangleIndex * 4 + 2],
                        bimElement.face_colors[triangleIndex * 4 + 3]
                    );
                    return faceMaterialIndex;
                }
                else if (defaultMaterialIndex) {
                    return defaultMaterialIndex;
                }
                return this.colorToMaterial.GetMaterialIndex(200,200,200,255);
            });
        }

        // 1.1.0 - colors
        if (bimMesh.colors)
        {
            let indices_length = bimMesh.indices.length;
            let colors_length = bimMesh.colors.length / 4;
            console.log(indices_length);
            console.log(colors_length);
            console.log("colors")
            // Vertex Color
            if (colors_length >= indices_length)
            {
                mesh = this.ImportMeshVertexColors (bimMesh, (vertexColorsTriangle) => {
                    let cc = new RGBAColor (200, 200, 200, 255);
                    let colors_array = [];
                    for (let c = 0; c < 3; c+=4) {
                        var color = new RGBAColor (
                            bimMesh.colors[vertexColorsTriangle * 12 + 0],
                            bimMesh.colors[vertexColorsTriangle * 12 + 1],
                            bimMesh.colors[vertexColorsTriangle * 12 + 2],
                            bimMesh.colors[vertexColorsTriangle * 12 + 3]
                        );
                        colors_array.push(colors_array);
                    }

                    return colors_array;
                });
            }
            else
            {
                mesh = this.ImportMeshMaterial (bimMesh, (triangleIndex) => {
                    if (defaultMaterialIndex)
                    {
                        return defaultMaterialIndex;
                    }
                    else if (bimMesh.colors)
                    {
                        let materialIndex = this.colorToMaterial.GetMaterialIndex (
                            bimMesh.colors[triangleIndex * 4 + 0],
                            bimMesh.colors[triangleIndex * 4 + 1],
                            bimMesh.colors[triangleIndex * 4 + 2],
                            bimMesh.colors[triangleIndex * 4 + 3]
                        );
                        return materialIndex;
                    }
                    return this.colorToMaterial.GetMaterialIndex(200,200,200,255);
                });
            }
        }


        let meshIndex = this.model.AddMesh (mesh);

        let elementNode = new Node ();
        elementNode.SetType (NodeType.MeshNode);
        elementNode.AddMeshIndex (meshIndex);

        let translation = new Coord3D (0.0, 0.0, 0.0);
        if (bimElement.vector) {
            translation = new Coord3D (
                bimElement.vector.x,
                bimElement.vector.y,
                bimElement.vector.z
            );
        }
        let rotation = new Quaternion (0.0, 0.0, 0.0, 1.0);
        if (bimElement.rotation) {
            rotation = new Quaternion (
                bimElement.rotation.qx,
                bimElement.rotation.qy,
                bimElement.rotation.qz,
                bimElement.rotation.qw
            );
        }
        let scale = new Coord3D (1.0, 1.0, 1.0);
        let matrix = new Matrix ().ComposeTRS (translation, rotation, scale);
        elementNode.SetTransformation (new Transformation (matrix));

        rootNode.AddChildNode (elementNode);
        return mesh;
    }

    ImportMeshMaterial (bimMesh, getMaterialIndex)
    {
        let mesh = new Mesh ();

        for (let i = 0; i < bimMesh.coordinates.length; i += 3) {
            mesh.AddVertex (new Coord3D (
                bimMesh.coordinates[i + 0],
                bimMesh.coordinates[i + 1],
                bimMesh.coordinates[i + 2]
            ));
        }

        for (let i = 0; i < bimMesh.indices.length; i += 3) {
            let triangle = new Triangle (
                bimMesh.indices[i + 0],
                bimMesh.indices[i + 1],
                bimMesh.indices[i + 2]
            );
            triangle.SetMaterial (getMaterialIndex (i / 3));
            mesh.AddTriangle (triangle);
        }

        return mesh;
    }

    ImportMeshVertexColors (bimMesh, getVertexColors)
    {
        let mesh = new Mesh ();
        let colorToVertexColorsConverter = new ColorToVertexColorsConverter(mesh);

        for (let i = 0; i < bimMesh.coordinates.length; i += 3) {
            mesh.AddVertex (new Coord3D (
                bimMesh.coordinates[i + 0],
                bimMesh.coordinates[i + 1],
                bimMesh.coordinates[i + 2]
            ));
        }

        for (let i = 0; i < bimMesh.indices.length; i += 3) {
            let triangle = new Triangle (
                bimMesh.indices[i + 0],
                bimMesh.indices[i + 1],
                bimMesh.indices[i + 2]
            );
            let colors = getVertexColors (i / 3);
            let color_index = colors.map(color => colorToVertexColorsConverter.GetVertexColorIndex(color));
            triangle.SetVertexColors (color_index[0],color_index[1],color_index[2]);
            mesh.AddTriangle (triangle);
        }

        return mesh;
    }

    ImportProperties (source, target)
    {
        function AddProperty (group, name, value)
        {
            if (value === undefined || value === null) {
                return;
            }
            let property = new Property (PropertyType.Text, name, value);
            group.AddProperty (property);
        }

        if (!source.info || IsObjectEmpty (source.info)) {
            return;
        }

        let info = source.info;
        let propertyGroup = new PropertyGroup ('Info');
        AddProperty (propertyGroup, 'Guid', source.guid);
        AddProperty (propertyGroup, 'Type', source.type);
        for (let propertyName in info) {
            if (Object.prototype.hasOwnProperty.call (info, propertyName)) {
                if (typeof info[propertyName] === 'string') {
                    AddProperty (propertyGroup, propertyName, info[propertyName]);
                }
            }
        }
        target.AddPropertyGroup (propertyGroup);
    }
}
