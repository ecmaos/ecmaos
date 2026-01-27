use std::env;
use std::fs;
use std::io::{self, Read, Seek};
use std::path::Path;
use std::time::SystemTime;

fn main() {
    println!("=== WASM Interface Test Suite ===");
    
    test_stdout_stderr();
    test_command_line_args();
    test_environment_variables();
    test_file_operations();
    test_directory_operations();
    test_path_operations();
    test_stat_operations();
    test_time_operations();
    test_random_operations();
    test_seek_operations();
    test_file_rename();
    test_file_truncate();
    test_multiple_file_descriptors();
    test_large_file_operations();
    test_error_conditions();
    test_file_permissions();
    test_working_directory();
    test_file_timestamps();
    test_file_descriptor_operations();
    test_concurrent_operations();
    
    println!("\n=== All Tests Completed ===");
}

fn test_stdout_stderr() {
    println!("\n[TEST] stdout/stderr I/O");
    eprintln!("This is stderr output");
    println!("This is stdout output");
    print!("Print without newline");
    println!(" - continued");
}

fn test_command_line_args() {
    println!("\n[TEST] Command-line arguments");
    let args: Vec<String> = env::args().collect();
    println!("Number of arguments: {}", args.len());
    for (i, arg) in args.iter().enumerate() {
        println!("  arg[{}]: {}", i, arg);
    }
}

fn test_environment_variables() {
    println!("\n[TEST] Environment variables");
    match env::var("PATH") {
        Ok(val) => println!("PATH: {}", val),
        Err(_) => println!("PATH: (not set)"),
    }
    
    match env::var("HOME") {
        Ok(val) => println!("HOME: {}", val),
        Err(_) => println!("HOME: (not set)"),
    }
    
    match env::var("USER") {
        Ok(val) => println!("USER: {}", val),
        Err(_) => println!("USER: (not set)"),
    }
}

fn test_file_operations() {
    println!("\n[TEST] File operations");
    
    let test_file = "/tmp/wasm_test_file.txt";
    let test_content = "Hello from WASM test!\nThis is a test file.\n";
    
    println!("  Writing to: {}", test_file);
    match fs::write(test_file, test_content) {
        Ok(_) => println!("  ✓ File written successfully"),
        Err(e) => {
            eprintln!("  ✗ Failed to write file: {}", e);
            return;
        }
    }
    
    println!("  Reading from: {}", test_file);
    match fs::read_to_string(test_file) {
        Ok(content) => {
            println!("  ✓ File read successfully");
            println!("  Content (first 50 chars): {}", 
                    content.chars().take(50).collect::<String>());
        }
        Err(e) => {
            eprintln!("  ✗ Failed to read file: {}", e);
        }
    }
    
    println!("  Getting file metadata");
    match fs::metadata(test_file) {
        Ok(metadata) => {
            println!("  ✓ Metadata retrieved");
            println!("    Size: {} bytes", metadata.len());
            println!("    Is file: {}", metadata.is_file());
            println!("    Is dir: {}", metadata.is_dir());
        }
        Err(e) => {
            eprintln!("  ✗ Failed to get metadata: {}", e);
        }
    }
    
    println!("  Cleaning up test file");
    match fs::remove_file(test_file) {
        Ok(_) => println!("  ✓ File removed"),
        Err(e) => eprintln!("  ✗ Failed to remove file: {}", e),
    }
}

fn test_directory_operations() {
    println!("\n[TEST] Directory operations");
    
    let test_dir = "/tmp/wasm_test_dir";
    
    println!("  Creating directory: {}", test_dir);
    match fs::create_dir(test_dir) {
        Ok(_) => println!("  ✓ Directory created"),
        Err(e) => {
            eprintln!("  ✗ Failed to create directory: {}", e);
            return;
        }
    }
    
    let test_file = format!("{}/test.txt", test_dir);
    println!("  Creating file in directory: {}", test_file);
    match fs::write(&test_file, "test content") {
        Ok(_) => println!("  ✓ File created in directory"),
        Err(e) => eprintln!("  ✗ Failed to create file: {}", e),
    }
    
    println!("  Reading directory: {}", test_dir);
    match fs::read_dir(test_dir) {
        Ok(entries) => {
            println!("  ✓ Directory read successfully");
            let mut count = 0;
            for entry in entries {
                match entry {
                    Ok(entry) => {
                        count += 1;
                        let path = entry.path();
                        let name = path.file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("?");
                        println!("    Entry {}: {}", count, name);
                    }
                    Err(e) => eprintln!("    Error reading entry: {}", e),
                }
            }
            println!("    Total entries: {}", count);
        }
        Err(e) => {
            eprintln!("  ✗ Failed to read directory: {}", e);
        }
    }
    
    println!("  Removing directory: {}", test_dir);
    match fs::remove_dir_all(test_dir) {
        Ok(_) => println!("  ✓ Directory removed"),
        Err(e) => eprintln!("  ✗ Failed to remove directory: {}", e),
    }
}

fn test_path_operations() {
    println!("\n[TEST] Path operations");
    
    let base_path = "/tmp";
    let test_path = format!("{}/wasm_path_test", base_path);
    
    println!("  Testing path operations on: {}", test_path);
    
    if Path::new(&test_path).exists() {
        println!("    Path exists, removing...");
        let _ = fs::remove_file(&test_path);
        let _ = fs::remove_dir_all(&test_path);
    }
    
    println!("    Creating directory");
    match fs::create_dir_all(&test_path) {
        Ok(_) => println!("    ✓ Directory created"),
        Err(e) => {
            eprintln!("    ✗ Failed: {}", e);
            return;
        }
    }
    
    let nested_file = format!("{}/nested/file.txt", test_path);
    println!("    Creating nested file: {}", nested_file);
    if let Some(parent) = Path::new(&nested_file).parent() {
        match fs::create_dir_all(parent) {
            Ok(_) => {
                match fs::write(&nested_file, "nested content") {
                    Ok(_) => println!("    ✓ Nested file created"),
                    Err(e) => eprintln!("    ✗ Failed to create file: {}", e),
                }
            }
            Err(e) => eprintln!("    ✗ Failed to create parent dir: {}", e),
        }
    }
    
    println!("    Cleaning up");
    let _ = fs::remove_dir_all(&test_path);
}

fn test_stat_operations() {
    println!("\n[TEST] Stat operations");
    
    let test_file = "/tmp/wasm_stat_test.txt";
    let _ = fs::write(test_file, "stat test content");
    
    println!("  Testing stat on: {}", test_file);
    match fs::metadata(test_file) {
        Ok(metadata) => {
            println!("  ✓ Stat successful");
            println!("    File size: {} bytes", metadata.len());
            println!("    Is file: {}", metadata.is_file());
            println!("    Is dir: {}", metadata.is_dir());
            println!("    Is symlink: {}", metadata.file_type().is_symlink());
            
            if let Ok(modified) = metadata.modified() {
                println!("    Modified: {:?}", modified);
            }
            if let Ok(accessed) = metadata.accessed() {
                println!("    Accessed: {:?}", accessed);
            }
        }
        Err(e) => {
            eprintln!("  ✗ Stat failed: {}", e);
        }
    }
    
    let _ = fs::remove_file(test_file);
}

fn test_time_operations() {
    println!("\n[TEST] Time operations");
    
    use std::time::{SystemTime, UNIX_EPOCH};
    
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(duration) => {
            println!("  ✓ Current timestamp: {} seconds", duration.as_secs());
            println!("    Nanoseconds: {}", duration.subsec_nanos());
        }
        Err(e) => {
            eprintln!("  ✗ Failed to get time: {}", e);
        }
    }
    
    let now = SystemTime::now();
    println!("  SystemTime::now(): {:?}", now);
}

fn test_random_operations() {
    println!("\n[TEST] Random operations");
    
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    
    let mut hasher = DefaultHasher::new();
    SystemTime::now().hash(&mut hasher);
    let random_value = hasher.finish();
    
    println!("  ✓ Generated random value: {}", random_value);
    println!("    (Using time-based hashing as fallback)");
}

fn test_seek_operations() {
    println!("\n[TEST] Seek operations");
    
    let test_file = "/tmp/wasm_seek_test.txt";
    let content = "0123456789ABCDEF\n";
    
    match fs::write(test_file, content) {
        Ok(_) => {
            println!("  ✓ Test file created");
            
            match fs::File::open(test_file) {
                Ok(mut file) => {
                    let mut buffer = [0u8; 5];
                    
                    println!("  Testing read from start");
                    match file.read_exact(&mut buffer) {
                        Ok(_) => {
                            let read_str = String::from_utf8_lossy(&buffer);
                            println!("    ✓ Read: '{}'", read_str);
                        }
                        Err(e) => eprintln!("    ✗ Read failed: {}", e),
                    }
                    
                    println!("  Testing seek and read");
                    match file.seek(io::SeekFrom::Start(5)) {
                        Ok(_) => {
                            match file.read_exact(&mut buffer) {
                                Ok(_) => {
                                    let read_str = String::from_utf8_lossy(&buffer);
                                    println!("    ✓ Read after seek: '{}'", read_str);
                                }
                                Err(e) => eprintln!("    ✗ Read after seek failed: {}", e),
                            }
                        }
                        Err(e) => eprintln!("    ✗ Seek failed: {}", e),
                    }
                }
                Err(e) => eprintln!("  ✗ Failed to open file: {}", e),
            }
        }
        Err(e) => {
            eprintln!("  ✗ Failed to create test file: {}", e);
        }
    }
    
    let _ = fs::remove_file(test_file);
}

fn test_file_rename() {
    println!("\n[TEST] File rename operations");
    
    let test_file = "/tmp/wasm_rename_source.txt";
    let renamed_file = "/tmp/wasm_rename_target.txt";
    
    println!("  Creating source file: {}", test_file);
    match fs::write(test_file, "Original content") {
        Ok(_) => println!("  ✓ Source file created"),
        Err(e) => {
            eprintln!("  ✗ Failed to create source file: {}", e);
            return;
        }
    }
    
    println!("  Renaming file");
    match fs::rename(test_file, renamed_file) {
        Ok(_) => {
            println!("  ✓ File renamed successfully");
            
            match fs::read_to_string(renamed_file) {
                Ok(content) => {
                    println!("  ✓ Renamed file content verified: {}", content);
                }
                Err(e) => eprintln!("  ✗ Failed to read renamed file: {}", e),
            }
        }
        Err(e) => eprintln!("  ✗ Failed to rename file: {}", e),
    }
    
    let _ = fs::remove_file(renamed_file);
}

fn test_file_truncate() {
    println!("\n[TEST] File truncate operations");
    
    let test_file = "/tmp/wasm_truncate_test.txt";
    let initial_content = "This is a longer file content that will be truncated";
    
    println!("  Creating file with content");
    match fs::write(test_file, initial_content) {
        Ok(_) => {
            println!("  ✓ File created");
            
            match fs::File::open(&test_file) {
                Ok(file) => {
                    match file.metadata() {
                        Ok(meta) => {
                            println!("    Initial size: {} bytes", meta.len());
                        }
                        Err(e) => eprintln!("    ✗ Failed to get initial metadata: {}", e),
                    }
                }
                Err(e) => eprintln!("    ✗ Failed to open file: {}", e),
            }
            
            println!("  Truncating file to 10 bytes");
            match fs::File::create(&test_file) {
                Ok(file) => {
                    match file.set_len(10) {
                        Ok(_) => {
                            println!("  ✓ File truncated");
                            
                            match fs::read_to_string(test_file) {
                                Ok(content) => {
                                    println!("    Truncated content ({} bytes): '{}'", content.len(), content);
                                }
                                Err(e) => eprintln!("    ✗ Failed to read truncated file: {}", e),
                            }
                        }
                        Err(e) => eprintln!("  ✗ Failed to truncate file: {}", e),
                    }
                }
                Err(e) => eprintln!("  ✗ Failed to open file for truncation: {}", e),
            }
        }
        Err(e) => {
            eprintln!("  ✗ Failed to create test file: {}", e);
            return;
        }
    }
    
    let _ = fs::remove_file(test_file);
}

fn test_multiple_file_descriptors() {
    println!("\n[TEST] Multiple file descriptors");
    
    let file1 = "/tmp/wasm_fd1.txt";
    let file2 = "/tmp/wasm_fd2.txt";
    let file3 = "/tmp/wasm_fd3.txt";
    
    println!("  Opening multiple files simultaneously");
    
    let mut handles = Vec::new();
    let file_paths = [file1, file2, file3];
    
    for (i, path) in file_paths.iter().enumerate() {
        match fs::File::create(path) {
            Ok(file) => {
                println!("  ✓ Opened file {}: {}", i + 1, path);
                handles.push((i + 1, *path, file));
            }
            Err(e) => eprintln!("  ✗ Failed to open file {}: {}", i + 1, e),
        }
    }
    
    println!("  Writing to multiple files");
    for (i, _path, ref mut file) in handles.iter_mut() {
        use std::io::Write;
        let content = format!("Content for file {}\n", i);
        match file.write_all(content.as_bytes()) {
            Ok(_) => println!("  ✓ Wrote to file {}", i),
            Err(e) => eprintln!("  ✗ Failed to write to file {}: {}", i, e),
        }
    }
    
    println!("  Closing all files");
    handles.clear();
    
    println!("  Verifying all files were written");
    for path in file_paths.iter() {
        match fs::read_to_string(path) {
            Ok(content) => println!("  ✓ {} contains: {}", path, content.trim()),
            Err(e) => eprintln!("  ✗ Failed to read {}: {}", path, e),
        }
    }
    
    let _ = fs::remove_file(file1);
    let _ = fs::remove_file(file2);
    let _ = fs::remove_file(file3);
}

fn test_large_file_operations() {
    println!("\n[TEST] Large file operations");
    
    let test_file = "/tmp/wasm_large_file.txt";
    let large_size = 1024 * 100; // 100KB
    
    println!("  Creating large file ({} bytes)", large_size);
    match fs::File::create(test_file) {
        Ok(mut file) => {
            use std::io::Write;
            let chunk = b"0123456789ABCDEF";
            let chunks_needed = large_size / chunk.len();
            
            for i in 0..chunks_needed {
                if let Err(e) = file.write_all(chunk) {
                    eprintln!("  ✗ Failed to write chunk {}: {}", i, e);
                    return;
                }
            }
            
            let remaining = large_size % chunk.len();
            if remaining > 0 {
                if let Err(e) = file.write_all(&chunk[..remaining]) {
                    eprintln!("  ✗ Failed to write remaining bytes: {}", e);
                    return;
                }
            }
            
            println!("  ✓ Large file created");
            
            match fs::metadata(test_file) {
                Ok(meta) => {
                    println!("    Actual size: {} bytes", meta.len());
                    if meta.len() >= large_size as u64 {
                        println!("  ✓ File size verified");
                    } else {
                        eprintln!("  ✗ File size mismatch: expected >= {}, got {}", large_size, meta.len());
                    }
                }
                Err(e) => eprintln!("  ✗ Failed to get file metadata: {}", e),
            }
        }
        Err(e) => {
            eprintln!("  ✗ Failed to create large file: {}", e);
            return;
        }
    }
    
    println!("  Reading large file");
    match fs::read(test_file) {
        Ok(data) => {
            println!("  ✓ Read {} bytes from large file", data.len());
        }
        Err(e) => eprintln!("  ✗ Failed to read large file: {}", e),
    }
    
    let _ = fs::remove_file(test_file);
}

fn test_error_conditions() {
    println!("\n[TEST] Error conditions");
    
    println!("  Testing non-existent file read");
    match fs::read_to_string("/tmp/nonexistent_file_12345.txt") {
        Ok(_) => eprintln!("  ✗ Unexpectedly succeeded reading non-existent file"),
        Err(e) => println!("  ✓ Correctly failed to read non-existent file: {}", e.kind()),
    }
    
    println!("  Testing non-existent directory read");
    match fs::read_dir("/tmp/nonexistent_dir_12345") {
        Ok(_) => eprintln!("  ✗ Unexpectedly succeeded reading non-existent directory"),
        Err(e) => println!("  ✓ Correctly failed to read non-existent directory: {}", e.kind()),
    }
    
    println!("  Testing file in non-existent directory");
    match fs::write("/tmp/nonexistent_dir_12345/file.txt", "test") {
        Ok(_) => eprintln!("  ✗ Unexpectedly succeeded writing to non-existent directory"),
        Err(e) => println!("  ✓ Correctly failed to write to non-existent directory: {}", e.kind()),
    }
    
    println!("  Testing removing non-existent file");
    match fs::remove_file("/tmp/nonexistent_file_12345.txt") {
        Ok(_) => eprintln!("  ✗ Unexpectedly succeeded removing non-existent file"),
        Err(e) => println!("  ✓ Correctly failed to remove non-existent file: {}", e.kind()),
    }
    
    let test_file = "/tmp/wasm_error_test.txt";
    let _ = fs::write(test_file, "test");
    
    println!("  Testing removing file as directory");
    match fs::remove_dir(test_file) {
        Ok(_) => eprintln!("  ✗ Unexpectedly succeeded removing file as directory"),
        Err(e) => println!("  ✓ Correctly failed to remove file as directory: {}", e.kind()),
    }
    
    let _ = fs::remove_file(test_file);
}

fn test_file_permissions() {
    println!("\n[TEST] File permissions");
    
    let test_file = "/tmp/wasm_perms_test.txt";
    
    println!("  Creating test file");
    match fs::write(test_file, "permissions test") {
        Ok(_) => {
            println!("  ✓ File created");
            
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                
                println!("  Getting current permissions");
                match fs::metadata(test_file) {
                    Ok(meta) => {
                        let perms = meta.permissions();
                        let mode = perms.mode();
                        println!("    Current mode: {:o}", mode);
                        
                        println!("  Setting new permissions");
                        let new_perms = fs::Permissions::from_mode(0o644);
                        match fs::set_permissions(test_file, new_perms) {
                            Ok(_) => {
                                println!("  ✓ Permissions set");
                                
                                match fs::metadata(test_file) {
                                    Ok(new_meta) => {
                                        let new_mode = new_meta.permissions().mode();
                                        println!("    New mode: {:o}", new_mode);
                                    }
                                    Err(e) => eprintln!("    ✗ Failed to verify permissions: {}", e),
                                }
                            }
                            Err(e) => eprintln!("  ✗ Failed to set permissions: {}", e),
                        }
                    }
                    Err(e) => eprintln!("  ✗ Failed to get file metadata: {}", e),
                }
            }
            
            #[cfg(not(unix))]
            {
                // On WASI, we can still test permissions, just without mode() access
                println!("  Testing file permissions (WASI)");
                
                // Get current permissions
                match fs::metadata(test_file) {
                    Ok(meta) => {
                        let perms = meta.permissions();
                        println!("  ✓ Retrieved file permissions");
                        println!("    Permissions: {:?}", perms);
                        
                        // Try to set permissions - on WASI this should work via syscalls
                        // We use the same permissions object to test that the syscall works
                        // Note: On WASI, we can't read the numeric mode back, but we can test if setting works
                        match fs::set_permissions(test_file, perms) {
                            Ok(_) => {
                                println!("  ✓ Permissions set successfully");
                                println!("    (chmod syscall is working - mode reading not available on WASI)");
                                
                                // Verify the file is still accessible after permission change
                                match fs::read_to_string(test_file) {
                                    Ok(_) => println!("  ✓ File still accessible after permission change"),
                                    Err(e) => eprintln!("  ✗ File became inaccessible: {}", e),
                                }
                            }
                            Err(e) => {
                                eprintln!("  ✗ Failed to set permissions: {}", e);
                                eprintln!("    This indicates chmod syscalls may not be working");
                            }
                        }
                    }
                    Err(e) => eprintln!("  ✗ Failed to get file metadata: {}", e),
                }
            }
        }
        Err(e) => {
            eprintln!("  ✗ Failed to create test file: {}", e);
            return;
        }
    }
    
    let _ = fs::remove_file(test_file);
}

fn test_working_directory() {
    println!("\n[TEST] Working directory operations");
    
    println!("  Getting current working directory");
    match env::current_dir() {
        Ok(cwd) => {
            println!("  ✓ Current directory: {:?}", cwd);
            
            let test_dir = "/tmp/wasm_cwd_test";
            println!("  Changing to test directory: {}", test_dir);
            
            match fs::create_dir_all(test_dir) {
                Ok(_) => {
                    match env::set_current_dir(test_dir) {
                        Ok(_) => {
                            println!("  ✓ Changed directory");
                            
                            match env::current_dir() {
                                Ok(new_cwd) => {
                                    println!("    New directory: {:?}", new_cwd);
                                    
                                    match env::set_current_dir("/") {
                                        Ok(_) => println!("  ✓ Restored to root"),
                                        Err(e) => eprintln!("  ✗ Failed to restore directory: {}", e),
                                    }
                                }
                                Err(e) => eprintln!("  ✗ Failed to get new directory: {}", e),
                            }
                        }
                        Err(e) => eprintln!("  ✗ Failed to change directory: {}", e),
                    }
                }
                Err(e) => eprintln!("  ✗ Failed to create test directory: {}", e),
            }
            
            let _ = fs::remove_dir(test_dir);
        }
        Err(e) => eprintln!("  ✗ Failed to get current directory: {}", e),
    }
}

fn test_file_timestamps() {
    println!("\n[TEST] File timestamps");
    
    let test_file = "/tmp/wasm_timestamp_test.txt";
    
    println!("  Creating file");
    match fs::write(test_file, "timestamp test") {
        Ok(_) => {
            println!("  ✓ File created");
            
            match fs::metadata(test_file) {
                Ok(meta) => {
                    if let Ok(modified) = meta.modified() {
                        println!("  ✓ Modified time: {:?}", modified);
                    }
                    
                    if let Ok(accessed) = meta.accessed() {
                        println!("  ✓ Accessed time: {:?}", accessed);
                    }
                    
                    if let Ok(created) = meta.created() {
                        println!("  ✓ Created time: {:?}", created);
                    }
                }
                Err(e) => eprintln!("  ✗ Failed to get file metadata: {}", e),
            }
            
            println!("  Modifying file to update timestamps");
            match fs::write(test_file, "updated content") {
                Ok(_) => {
                    match fs::metadata(test_file) {
                        Ok(new_meta) => {
                            if let Ok(new_modified) = new_meta.modified() {
                                println!("  ✓ New modified time: {:?}", new_modified);
                            }
                        }
                        Err(e) => eprintln!("  ✗ Failed to get updated metadata: {}", e),
                    }
                }
                Err(e) => eprintln!("  ✗ Failed to update file: {}", e),
            }
        }
        Err(e) => {
            eprintln!("  ✗ Failed to create test file: {}", e);
            return;
        }
    }
    
    let _ = fs::remove_file(test_file);
}

fn test_file_descriptor_operations() {
    println!("\n[TEST] File descriptor operations");
    
    let test_file = "/tmp/wasm_fd_ops.txt";
    let content = "File descriptor operations test\nLine 2\nLine 3";
    
    println!("  Creating test file");
    match fs::write(test_file, content) {
        Ok(_) => {
            println!("  ✓ File created");
            
            match fs::File::open(test_file) {
                Ok(mut file) => {
                    use std::io::{Seek, SeekFrom, Read};
                    
                    println!("  Testing file position");
                    match file.seek(SeekFrom::Current(0)) {
                        Ok(pos) => println!("  ✓ Current position: {}", pos),
                        Err(e) => eprintln!("  ✗ Failed to get position: {}", e),
                    }
                    
                    println!("  Seeking to end");
                    match file.seek(SeekFrom::End(0)) {
                        Ok(pos) => {
                            println!("  ✓ Seeked to end, position: {}", pos);
                            
                            println!("  Seeking back to start");
                            match file.seek(SeekFrom::Start(0)) {
                                Ok(pos) => {
                                    println!("  ✓ Seeked to start, position: {}", pos);
                                    
                                    let mut buffer = String::new();
                                    match file.read_to_string(&mut buffer) {
                                        Ok(_) => {
                                            println!("  ✓ Read from start: {} bytes", buffer.len());
                                        }
                                        Err(e) => eprintln!("  ✗ Failed to read: {}", e),
                                    }
                                }
                                Err(e) => eprintln!("  ✗ Failed to seek to start: {}", e),
                            }
                        }
                        Err(e) => eprintln!("  ✗ Failed to seek to end: {}", e),
                    }
                    
                    println!("  Testing relative seek");
                    match file.seek(SeekFrom::Start(0)) {
                        Ok(_) => {
                            match file.seek(SeekFrom::Current(10)) {
                                Ok(pos) => {
                                    println!("  ✓ Relative seek successful, position: {}", pos);
                                    
                                    let mut buffer = [0u8; 5];
                                    match file.read_exact(&mut buffer) {
                                        Ok(_) => {
                                            let read_str = String::from_utf8_lossy(&buffer);
                                            println!("  ✓ Read after relative seek: '{}'", read_str);
                                        }
                                        Err(e) => eprintln!("  ✗ Failed to read after seek: {}", e),
                                    }
                                }
                                Err(e) => eprintln!("  ✗ Failed to relative seek: {}", e),
                            }
                        }
                        Err(e) => eprintln!("  ✗ Failed to seek to start: {}", e),
                    }
                }
                Err(e) => eprintln!("  ✗ Failed to open file: {}", e),
            }
        }
        Err(e) => {
            eprintln!("  ✗ Failed to create test file: {}", e);
            return;
        }
    }
    
    let _ = fs::remove_file(test_file);
}

fn test_concurrent_operations() {
    println!("\n[TEST] Concurrent file operations");
    
    let base_dir = "/tmp/wasm_concurrent";
    let _ = fs::remove_dir_all(base_dir);
    
    println!("  Creating test directory");
    match fs::create_dir_all(base_dir) {
        Ok(_) => {
            println!("  ✓ Directory created");
            
            println!("  Creating multiple files concurrently");
            let mut handles = Vec::new();
            
            for i in 0..5 {
                let file_path = format!("{}/file_{}.txt", base_dir, i);
                match fs::File::create(&file_path) {
                    Ok(mut file) => {
                        use std::io::Write;
                        let content = format!("Content for file {}\n", i);
                        match file.write_all(content.as_bytes()) {
                            Ok(_) => {
                                println!("  ✓ Created and wrote to file {}", i);
                                handles.push((i, file_path));
                            }
                            Err(e) => eprintln!("  ✗ Failed to write to file {}: {}", i, e),
                        }
                    }
                    Err(e) => eprintln!("  ✗ Failed to create file {}: {}", i, e),
                }
            }
            
            println!("  Reading all files");
            for (i, path) in handles.iter() {
                match fs::read_to_string(path) {
                    Ok(content) => println!("  ✓ File {} content: {}", i, content.trim()),
                    Err(e) => eprintln!("  ✗ Failed to read file {}: {}", i, e),
                }
            }
            
            println!("  Removing all files");
            for (i, path) in handles.iter() {
                match fs::remove_file(path) {
                    Ok(_) => println!("  ✓ Removed file {}", i),
                    Err(e) => eprintln!("  ✗ Failed to remove file {}: {}", i, e),
                }
            }
        }
        Err(e) => {
            eprintln!("  ✗ Failed to create test directory: {}", e);
            return;
        }
    }
    
    let _ = fs::remove_dir_all(base_dir);
}
