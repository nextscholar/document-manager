import React, { useState } from 'react';

const FileUploader = () => {
  const [files, setFiles] = useState([]);
  const maxSize = 1 * 1024 * 1024; // 1MB
  const maxFiles = 10;

  const handleFileChange = (event) => {
    const newFiles = Array.from(event.target.files);
    if (newFiles.length + files.length > maxFiles) {
      alert(`You can upload a maximum of ${maxFiles} files.`);
      return;
    }

    newFiles.forEach(file => {
      if (file.size > maxSize) {
        alert(`${file.name} is too large. Maximum file size is 1MB.`);
      } else {
        setFiles(prevFiles => [...prevFiles, file]);
      }
    });
  };

  const handleDelete = (filename) => {
    setFiles(files.filter(file => file.name !== filename));
  };

  return (
    <div>
      <input type='file' multiple onChange={handleFileChange} />
      <ul>
        {files.map(file => (
          <li key={file.name}>
            {file.name} <button onClick={() => handleDelete(file.name)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default FileUploader;